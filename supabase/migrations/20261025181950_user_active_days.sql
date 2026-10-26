-- The days each account used Weft, for the admin Users page's Last seen and per-user activity calendar, and Growth.
--
-- Supabase Auth keeps only an account's last sign-in, and the desktop app stays signed in for weeks on refresh tokens,
-- so auth.users.last_sign_in_at read "10d ago" for someone using Weft every day. While Weft is open (desktop or web) it
-- refreshes its token about hourly, and each refresh updates the account's row in auth.sessions: a trigger there writes
-- that day into the ledger. No app change, no Auth hook to configure.

create table public.user_active_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  -- The latest activity that day, so Last seen is a time and not just a date.
  last_at timestamptz not null default now(),
  primary key (user_id, day)
);

comment on table public.user_active_days is
  'One row per account per UTC day it used Weft (a sign-in or token refresh, synced card work, Puku trial use). Service role only.';

-- RLS on and no policies: only the service role (the admin pages, Growth) reads it.
alter table public.user_active_days enable row level security;
revoke all on public.user_active_days from anon, authenticated;

create or replace function private.note_active_day()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.user_active_days (user_id, day, last_at)
    values (new.user_id, (now() at time zone 'UTC')::date, now())
    on conflict (user_id, day) do update set last_at = greatest(public.user_active_days.last_at, excluded.last_at);
  exception when others then
    -- A sign-in or token refresh must never fail over bookkeeping.
    null;
  end;
  return new;
end;
$$;

revoke all on function private.note_active_day() from public, anon, authenticated;

-- Insert is a sign-in; update is a token refresh.
create trigger on_auth_session_active
  after insert or update on auth.sessions
  for each row execute function private.note_active_day();

-- Backfill from what was already recorded: synced card work, Puku trial days, sign-ins and the sessions' own times.
insert into public.user_active_days (user_id, day, last_at)
select a.user_id, (a.at at time zone 'UTC')::date, max(a.at)
  from (
    select c.owner_user as user_id, i.at
      from public.cloud_thread_items i
      join public.cloud_cards c on c.org_id = i.org_id and c.card_id = i.card_id
     where c.owner_user is not null
    union all
    -- A trial row's updated_at can fall on a later day than its day; then the day's start stands in.
    select t.user_id,
           case when (t.updated_at at time zone 'UTC')::date = t.day then t.updated_at else t.day::timestamp at time zone 'UTC' end
      from public.puku_trial_usage t
     where t.requests > 0
    union all
    select u.id, u.last_sign_in_at from auth.users u where u.last_sign_in_at is not null
    union all
    select p.id, p.last_login_at from public.profiles p where p.last_login_at is not null
    union all
    select s.user_id, s.created_at from auth.sessions s
    union all
    select s.user_id, s.refreshed_at at time zone 'UTC' from auth.sessions s where s.refreshed_at is not null
  ) a
 group by a.user_id, (a.at at time zone 'UTC')::date
on conflict (user_id, day) do nothing;

-- Growth's activity counts the ledger too, so a day someone only had Weft open (no synced cards) is an active day.
create or replace function private.growth_activity(since timestamptz)
returns table (user_id uuid, day date)
language sql
stable
security definer
set search_path = ''
as $$
  -- Items of a card deleted since still count: the work happened.
  select c.owner_user, (i.at at time zone 'UTC')::date
    from public.cloud_thread_items i
    join public.cloud_cards c on c.org_id = i.org_id and c.card_id = i.card_id
   where i.at >= since and c.owner_user is not null
  union
  select t.user_id, t.day
    from public.puku_trial_usage t
   where t.requests > 0 and t.day >= (since at time zone 'UTC')::date
  union
  -- Supabase Auth keeps only the last sign-in, and Weft's profile its own last login: each is one active day.
  select u.id, (u.last_sign_in_at at time zone 'UTC')::date from auth.users u where u.last_sign_in_at >= since
  union
  select p.id, (p.last_login_at at time zone 'UTC')::date from public.profiles p where p.last_login_at >= since
  union
  select d.user_id, d.day from public.user_active_days d where d.day >= (since at time zone 'UTC')::date;
$$;

revoke all on function private.growth_activity(timestamptz) from public, anon, authenticated;

-- Each account's last activity: the latest of its ledger, its sessions, its sign-in and its synced cards.
create or replace function public.admin_users_last_seen()
returns table (user_id uuid, last_seen_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  -- greatest() skips nulls, so an account with none of these reads null ("never").
  select u.id, greatest(
           u.last_sign_in_at,
           (select max(d.last_at) from public.user_active_days d where d.user_id = u.id),
           (select max(s.refreshed_at) at time zone 'UTC' from auth.sessions s where s.user_id = u.id),
           (select max(c.updated_at) from public.cloud_cards c where c.owner_user = u.id)
         )
    from auth.users u;
$$;

revoke all on function public.admin_users_last_seen() from public, anon, authenticated;
grant execute on function public.admin_users_last_seen() to service_role;

-- One account's activity for the admin drawer: a row per day for the last `days` days (active, cards touched, thread
-- items synced) and its counts. Streaks and rates are worked out in lib/admin-activity.ts.
create or replace function public.admin_user_activity(uid uuid, days integer default 84)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with span as (
    select (now() at time zone 'UTC')::date - (least(greatest(days, 7), 366) - 1) as first_day
  ),
  calendar as (
    select g::date as day
      from span, generate_series(span.first_day, (now() at time zone 'UTC')::date, interval '1 day') g
  ),
  work as (
    select (i.at at time zone 'UTC')::date as day, count(distinct i.card_id) as cards, count(*) as items
      from public.cloud_cards c
      join public.cloud_thread_items i on i.org_id = c.org_id and i.card_id = c.card_id
     where c.owner_user = uid and i.at >= (select first_day from span)::timestamp at time zone 'UTC'
     group by 1
  ),
  active as (
    select d.day from public.user_active_days d, span where d.user_id = uid and d.day >= span.first_day
    union
    select t.day from public.puku_trial_usage t, span where t.user_id = uid and t.requests > 0 and t.day >= span.first_day
  )
  select jsonb_build_object(
    'days', (
      select jsonb_agg(jsonb_build_object(
               'day', cal.day,
               'active', a.day is not null or w.day is not null,
               'cards', coalesce(w.cards, 0),
               'items', coalesce(w.items, 0)
             ) order by cal.day)
        from calendar cal
        left join active a on a.day = cal.day
        left join work w on w.day = cal.day
    ),
    'firstActiveDay', (select min(d.day) from public.user_active_days d where d.user_id = uid),
    'cards', (select count(*) from public.cloud_cards c where c.owner_user = uid and not c.deleted),
    'sessions', (select count(*) from auth.sessions s where s.user_id = uid and (s.not_after is null or s.not_after > now())),
    'workspaces', (select count(*) from public.org_memberships m where m.user_id = uid),
    'shares', (select count(*) from public.cloud_shares s where s.created_by = uid),
    'apps', (select count(*) from public.cloud_mini_apps a where a.created_by = uid and not a.deleted),
    'invitesSent', (select count(*) from public.invitations v where v.invited_by = uid),
    'pukuRequests', (select coalesce(sum(t.requests), 0) from public.puku_trial_usage t where t.user_id = uid)
  );
$$;

revoke all on function public.admin_user_activity(uuid, integer) from public, anon, authenticated;
grant execute on function public.admin_user_activity(uuid, integer) to service_role;
