-- Tunnels, the webhook relay and dev servers on a Weft Worker (docs/architecture/tunnels.md#on-a-worker).
--
-- A worker has no session, so it can't write a `tunnels` row the way a Mac does, and it has no Touch ID. Its owner's Mac
-- approves instead: the worker asks with a `tunnel_open` device call (worker_mac_ask), the Mac asks the user with Touch ID
-- and, as the owner, makes or reuses the row and stamps it approved for that worker, that target and that long. Only
-- then can the worker's key publish a URL on it (worker_tunnel_open), and only a quick tunnel's. A relay works the same
-- way: a `relay_create` call, the Mac seals the signing secret after Touch ID and inserts the relay row as the owner.
-- Supabase only ever carries names, sealed bytes and the public URL; /t/<id> stays owner-only (the row's user_id).

-- 1. Who may write what. A Mac's own tunnels and relays leave these null and are unchanged.
create or replace function private.owns_worker(p_worker uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cloud_workers w
    where w.id = p_worker and w.owner_user = (select auth.uid()) and w.kind = 'headless' and w.revoked_at is null
  );
$$;

revoke all on function private.owns_worker(uuid) from public, anon;
grant execute on function private.owns_worker(uuid) to authenticated;

alter table public.tunnels
  add column if not exists worker_id uuid references public.cloud_workers (id) on delete cascade,
  add column if not exists approved_target text check (approved_target is null or approved_target ~ '^http://(localhost|127\.0\.0\.1|\[::1\]):[0-9]{1,5}$'),
  add column if not exists approved_until timestamptz;

create index if not exists tunnels_worker_id on public.tunnels (worker_id) where worker_id is not null;

-- A row can name a worker only of the owner's own.
drop policy if exists "tunnels: add own" on public.tunnels;
create policy "tunnels: add own" on public.tunnels
  for insert to authenticated
  with check ((select auth.uid()) = user_id and (worker_id is null or private.owns_worker(worker_id)));

grant select (worker_id, approved_target, approved_until) on public.tunnels to authenticated;
grant insert (worker_id) on public.tunnels to authenticated;
grant update (approved_target, approved_until) on public.tunnels to authenticated;

alter table public.webhook_relays
  add column if not exists worker_id uuid references public.cloud_workers (id) on delete cascade,
  add column if not exists worker_origin text check (worker_origin is null or worker_origin ~ '^http://(localhost|127\.0\.0\.1|\[::1\]):[0-9]{1,5}$');

drop policy if exists "webhook_relays: add own" on public.webhook_relays;
create policy "webhook_relays: add own" on public.webhook_relays
  for insert to authenticated
  with check ((select auth.uid()) = user_id and (worker_id is null or private.owns_worker(worker_id)));

grant select (worker_id, worker_origin, tunnel_id, tunnel_path) on public.webhook_relays to authenticated;
grant insert (worker_id, worker_origin, tunnel_id, tunnel_path) on public.webhook_relays to authenticated;

-- 2. The asks travel worker to Mac in device_calls, beside Local Simulator mode's tools and H8's secret_run.
alter table public.device_calls drop constraint device_calls_tool_check;
alter table public.device_calls add constraint device_calls_tool_check
  check (tool in ('list_devices', 'boot', 'install', 'launch', 'open_url', 'ui_tree', 'tap', 'swipe', 'type_text', 'press', 'screenshot', 'logs', 'watch', 'secret_run', 'tunnel_open', 'relay_create'));

-- Queues an approval for the owner's most recently seen desktop, or null when none has beaten in a minute. The card has
-- to be this worker's, and one ask per card and tool waits at a time, so a thread can't stack Touch ID prompts.
create or replace function public.worker_mac_ask(p_key text, p_card text, p_tool text, p_args jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
  mac text;
  made uuid;
begin
  if p_tool not in ('tunnel_open', 'relay_create') then
    raise exception 'a worker can''t ask for that' using errcode = '22023';
  end if;
  delete from public.device_calls where worker_id = w.id and created_at < now() - interval '1 hour';
  if not exists (
    select 1 from public.cloud_cards c
    where c.org_id = w.org_id and c.card_id = p_card and c.owner_worker = w.id
  ) then
    raise exception 'that card is not this worker''s' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('worker_mac_ask:' || w.id::text, 0));
  if exists (
    select 1 from public.device_calls
    where worker_id = w.id and card_id = p_card and tool = p_tool and status in ('pending', 'claimed') and created_at > now() - interval '10 minutes'
  ) then
    raise exception 'that card already has an approval waiting' using errcode = '53400';
  end if;
  select d.device into mac from public.cloud_workers d
    where d.kind = 'desktop' and d.owner_user = w.owner_user and d.org_id = w.org_id and d.device is not null
      and d.revoked_at is null and d.last_seen_at > now() - interval '60 seconds'
    order by d.last_seen_at desc
    limit 1;
  if mac is null then
    return null;
  end if;
  -- The mark device_calls_approval_origin checks, for this insert only.
  perform set_config('weft.mac_ask', w.id::text, true);
  insert into public.device_calls (org_id, owner_user, worker_id, target_device, card_id, tool, args)
    values (w.org_id, w.owner_user, w.id, mac, p_card, p_tool, coalesce(p_args, '{}'::jsonb))
    returning id into made;
  perform set_config('weft.mac_ask', '', true);
  return made;
end;
$$;

-- An approval only comes through worker_mac_ask, with its one-at-a-time limit: worker_device_call takes any tool the
-- check allows, and would otherwise let a worker stack Touch ID prompts on a Mac it names.
create or replace function private.device_calls_approval_origin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tool in ('tunnel_open', 'relay_create') and coalesce(current_setting('weft.mac_ask', true), '') <> new.worker_id::text then
    raise exception 'a worker asks for that with worker_mac_ask' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.device_calls_approval_origin() from public, anon, authenticated;

drop trigger if exists device_calls_approval_origin on public.device_calls;
create trigger device_calls_approval_origin before insert on public.device_calls
  for each row execute function private.device_calls_approval_origin();

-- 3. The worker's writes. A URL goes up only on a row the owner approved for this worker, until that approval runs out,
-- and only a quick tunnel's: the address can't be pointed anywhere else. The worker's relays to that server follow it.
create or replace function public.worker_tunnel_open(p_key text, p_tunnel uuid, p_url text, p_secret text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
  t public.tunnels;
begin
  if p_url !~ '^https://[a-z0-9-]+\.trycloudflare\.com$' or p_secret !~ '^[0-9a-f]{64}$' then
    raise exception 'that isn''t a quick tunnel' using errcode = '22023';
  end if;
  update public.tunnels
    set public_url = p_url, ticket_secret = p_secret, expires_at = approved_until, updated_at = now()
    where id = p_tunnel and worker_id = w.id and user_id = w.owner_user and approved_until > now()
    returning * into t;
  if t.id is null then
    raise exception 'that tunnel isn''t approved for this worker' using errcode = '42501';
  end if;
  update public.webhook_relays
    set tunnel_id = t.id
    where worker_id = w.id and user_id = w.owner_user and worker_origin = t.approved_target;
  return t.expires_at;
end;
$$;

-- The kill switch: the row forgets the URL, the secret and the approval, so opening again asks again.
create or replace function public.worker_tunnel_close(p_key text, p_tunnel uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
begin
  update public.tunnels
    set public_url = null, ticket_secret = null, expires_at = null, approved_until = null, updated_at = now()
    where id = p_tunnel and worker_id = w.id;
  update public.webhook_relays set tunnel_id = null where tunnel_id = p_tunnel and worker_id = w.id;
end;
$$;

-- 4. A worker's dev servers for the board's Services drawer: command, folder name, localhost url, state and the tunnel
-- address when one is open. Nothing secret; workspace-readable like the rest of the row.
alter table public.cloud_workers
  add column if not exists dev_servers jsonb check (dev_servers is null or pg_column_size(dev_servers) < 16384);

-- The table's grants are per column (20261029125616_weft_workers.sql): without this the drawer's read is refused.
grant select (dev_servers) on public.cloud_workers to authenticated;

create or replace function public.worker_set_dev_servers(p_key text, p_servers jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
begin
  if jsonb_typeof(coalesce(p_servers, '[]'::jsonb)) <> 'array' then
    raise exception 'dev servers are a list' using errcode = '22023';
  end if;
  update public.cloud_workers set dev_servers = coalesce(p_servers, '[]'::jsonb) where id = w.id;
end;
$$;

revoke all on function public.worker_mac_ask(text, text, text, jsonb) from public;
revoke all on function public.worker_tunnel_open(text, uuid, text, text) from public;
revoke all on function public.worker_tunnel_close(text, uuid) from public;
revoke all on function public.worker_set_dev_servers(text, jsonb) from public;
grant execute on function public.worker_mac_ask(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.worker_tunnel_open(text, uuid, text, text) to anon, authenticated;
grant execute on function public.worker_tunnel_close(text, uuid) to anon, authenticated;
grant execute on function public.worker_set_dev_servers(text, jsonb) to anon, authenticated;
