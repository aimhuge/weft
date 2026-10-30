-- Phone push (docs/architecture/mobile.md#push). The Weft phone app (~/dev/weft-mobile) signs in to this project
-- and registers its Expo push token here; when a synced card (public.cloud_cards) moves into needs_you or review,
-- a trigger posts it to the push-card Edge Function (supabase/functions/push-card), which sends an Expo push to every
-- phone of the card's owner. The trigger runs in the database, so it fires whichever Mac (or the web board) moved it.

-- One row per phone. expo_token is unique: a phone has one token, and when someone else signs in on it the token
-- moves to them (public.register_push_device), so a phone never buzzes for two accounts.
create table public.push_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  expo_token   text not null unique check (expo_token ~ '^(Exponent|Expo)PushToken\[.+\]$'),
  platform     text not null check (platform in ('ios', 'android')),
  device_name  text check (char_length(device_name) <= 120),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_devices_user_id_idx on public.push_devices (user_id);

alter table public.push_devices enable row level security;

revoke all on public.push_devices from anon, authenticated;

create policy "push_devices: read own" on public.push_devices
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "push_devices: insert own" on public.push_devices
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "push_devices: update own" on public.push_devices
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "push_devices: delete own" on public.push_devices
  for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.push_devices to authenticated;

-- The phone's register call: claims the token for the signed-in user (taking it from whoever had it before, which
-- RLS alone can't do) and bumps last_seen_at. The app calls it at every launch.
create function public.register_push_device(p_expo_token text, p_platform text, p_device_name text default null)
returns public.push_devices
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  saved public.push_devices;
begin
  if me is null then
    raise exception 'Sign in to register a phone' using errcode = '42501';
  end if;
  insert into public.push_devices (user_id, expo_token, platform, device_name)
  values (me, p_expo_token, p_platform, p_device_name)
  on conflict (expo_token) do update
    set user_id = excluded.user_id, platform = excluded.platform,
        device_name = coalesce(excluded.device_name, public.push_devices.device_name), last_seen_at = now()
  returning * into saved;
  return saved;
end;
$$;

revoke all on function public.register_push_device(text, text, text) from public, anon;
grant execute on function public.register_push_device(text, text, text) to authenticated;

-- The debounce: the last column each card was pushed for. A card flapping review → running → review inside
-- ten minutes pushes once; a new column, or the same one after ten minutes, pushes again.
create table private.push_card_state (
  org_id    uuid not null,
  card_id   text not null,
  "column"  text not null,
  pushed_at timestamptz not null default now(),
  primary key (org_id, card_id)
);

alter table private.push_card_state enable row level security;

create extension if not exists pg_net with schema extensions;

-- The Edge Function's url and the shared secret the trigger signs with live in Supabase Vault
-- (push_hook_url, push_hook_secret), set once per project outside the migration, so no value sits in git.
-- Missing either, the trigger does nothing.
create function private.push_hook_secret() returns text
language sql stable security definer set search_path = ''
as $$ select decrypted_secret from vault.decrypted_secrets where name = 'push_hook_secret' limit 1 $$;

-- What the Edge Function calls to check a delivery came from this trigger. Service role only.
create function public.push_hook_ok(p_secret text) returns boolean
language sql stable security definer set search_path = ''
as $$ select p_secret is not null and p_secret = private.push_hook_secret() $$;

revoke all on function public.push_hook_ok(text) from public, anon, authenticated;
grant execute on function public.push_hook_ok(text) to service_role;

create function private.push_on_card_column() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  col text := new.card ->> 'column';
  moved_at bigint := case when new.card ->> 'columnAt' ~ '^\d{1,15}$' then (new.card ->> 'columnAt')::bigint end;
  hook_url text;
  hook_secret text;
  claimed int;
begin
  if new.deleted or new.owner_user is null or col not in ('needs_you', 'review')
     or col is not distinct from (old.card ->> 'column') then
    return null;
  end if;
  -- An outbox catching up after a Mac was offline replays old moves; only push a move from the last hour.
  if moved_at is not null and moved_at < (extract(epoch from now()) * 1000)::bigint - 3600000 then
    return null;
  end if;
  insert into private.push_card_state as s (org_id, card_id, "column", pushed_at)
  values (new.org_id, new.card_id, col, now())
  on conflict (org_id, card_id) do update set "column" = excluded."column", pushed_at = excluded.pushed_at
    where s."column" is distinct from excluded."column" or s.pushed_at < now() - interval '10 minutes';
  get diagnostics claimed = row_count;
  if claimed = 0 then
    return null;
  end if;
  select decrypted_secret into hook_url from vault.decrypted_secrets where name = 'push_hook_url' limit 1;
  hook_secret := private.push_hook_secret();
  if hook_url is null or hook_secret is null then
    return null;
  end if;
  -- A push never holds up or fails the sync's upsert: pg_net only queues the request, and any error is dropped.
  begin
    perform net.http_post(
      url := hook_url,
      body := jsonb_build_object('org_id', new.org_id, 'card_id', new.card_id, 'column', col),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-weft-push-secret', hook_secret),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning 'push_on_card_column: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function private.push_on_card_column() from public, anon, authenticated;

create trigger cloud_cards_push_on_column
  after update of card on public.cloud_cards
  for each row execute function private.push_on_card_column();
