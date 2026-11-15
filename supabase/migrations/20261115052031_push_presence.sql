-- Push only when you're away (docs/architecture/mobile.md#push). The push-card Edge Function skips a push when a Mac
-- of yours reported in the last 3 minutes with its keyboard touched under 5 minutes ago, or a phone of yours had the
-- app open in the last 2 minutes (supabase/functions/push-card/away.ts). No rows means away.

-- One row per Mac: Weft upserts it every minute while cloud sync is on (lib/mac-presence.ts), with the system idle
-- time from Electron's powerMonitor. updated_at is the database's clock, never the Mac's, so a skewed clock can't
-- keep a Mac "present" forever.
create table public.device_presence (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id    text not null check (char_length(device_id) between 1 and 128),
  idle_seconds int not null default 0 check (idle_seconds >= 0),
  updated_at   timestamptz not null default now(),
  primary key (user_id, device_id)
);

alter table public.device_presence enable row level security;

revoke all on public.device_presence from anon, authenticated;

create policy "device_presence: read own" on public.device_presence
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "device_presence: insert own" on public.device_presence
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "device_presence: update own" on public.device_presence
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "device_presence: delete own" on public.device_presence
  for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.device_presence to authenticated;

create function private.device_presence_stamp() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger device_presence_stamp
  before insert or update on public.device_presence
  for each row execute function private.device_presence_stamp();

-- When the phone app was last in the foreground; null once it goes to the background.
alter table public.push_devices add column foreground_at timestamptz;

-- The phone calls this on foreground and background, and once a minute while open. Touches only the caller's own row
-- (a token someone else holds is left alone), and bumps last_seen_at too. Returns whether a row matched.
create function public.touch_push_device(p_expo_token text, p_foreground boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  touched int;
begin
  if me is null then
    raise exception 'Sign in to touch a phone' using errcode = '42501';
  end if;
  update public.push_devices
     set foreground_at = case when p_foreground then now() end, last_seen_at = now()
   where expo_token = p_expo_token and user_id = me;
  get diagnostics touched = row_count;
  return touched > 0;
end;
$$;

revoke all on function public.touch_push_device(text, boolean) from public, anon;
grant execute on function public.touch_push_device(text, boolean) to authenticated;
