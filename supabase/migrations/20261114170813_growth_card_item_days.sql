-- Growth's activity reads time out: private.growth_activity and private.growth_engagement_activity found the days each
-- account worked by scanning every synced thread item (374k rows, 416 MB) and joining each to its card. On this database
-- that scan alone takes ~8 s, so the Growth app's active-per-day, weekly retention, in-app retention and in-app engagement panels ran past
-- the API's 8 s statement timeout ("canceling statement due to statement timeout"). The covering index of
-- 20261103033051 made the scan index-only but couldn't make it small.
--
-- What the reads need is tiny: one row per card per day it had a synced item, with how many items and turns (~4k rows).
-- private.growth_card_item_days keeps exactly that, filled once from the items and kept current by statement-level
-- triggers on insert, update and delete (sync upserts items, so insert and update both fire). A deleted item takes its
-- counts back but leaves its day: the work happened.

create table if not exists private.growth_card_item_days (
  org_id uuid not null,
  card_id text not null,
  day date not null,
  -- The items synced that day, and how many were turns: kind 'assistant' or 'user', a message through the CLI rather
  -- than a tool call. Counted on insert and delete, so a thread truncated and sent again isn't counted twice.
  items int not null default 0,
  turns int not null default 0,
  primary key (org_id, card_id, day)
);

create index if not exists growth_card_item_days_day on private.growth_card_item_days (day);

revoke all on table private.growth_card_item_days from public, anon, authenticated;

-- Insert adds the new items' counts; update (an upsert that hit an existing item) only makes sure the day is there.
create or replace function private.growth_card_item_days_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.growth_card_item_days as d (org_id, card_id, day, items, turns)
  select n.org_id, n.card_id, (n.at at time zone 'UTC')::date,
         case when tg_op = 'INSERT' then count(*)::int else 0 end,
         case when tg_op = 'INSERT' then (count(*) filter (where n.kind in ('assistant', 'user')))::int else 0 end
    from new_rows n
   group by 1, 2, 3
  on conflict (org_id, card_id, day) do update
     set items = d.items + excluded.items, turns = d.turns + excluded.turns
   where excluded.items > 0;
  return null;
exception when others then
  -- Syncing a thread must never fail over growth bookkeeping.
  return null;
end;
$$;

-- Delete takes the items back off; the day stays, since the work still happened that day.
create or replace function private.growth_card_item_days_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.growth_card_item_days d
     set items = greatest(0, d.items - o.items), turns = greatest(0, d.turns - o.turns)
    from (
      select r.org_id, r.card_id, (r.at at time zone 'UTC')::date as day, count(*)::int as items,
             (count(*) filter (where r.kind in ('assistant', 'user')))::int as turns
        from old_rows r
       group by 1, 2, 3
    ) o
   where d.org_id = o.org_id and d.card_id = o.card_id and d.day = o.day;
  return null;
exception when others then
  return null;
end;
$$;

revoke all on function private.growth_card_item_days_added() from public, anon, authenticated;
revoke all on function private.growth_card_item_days_removed() from public, anon, authenticated;

drop trigger if exists growth_card_item_days_insert on public.cloud_thread_items;
create trigger growth_card_item_days_insert
  after insert on public.cloud_thread_items
  referencing new table as new_rows
  for each statement execute function private.growth_card_item_days_added();

drop trigger if exists growth_card_item_days_update on public.cloud_thread_items;
create trigger growth_card_item_days_update
  after update on public.cloud_thread_items
  referencing new table as new_rows
  for each statement execute function private.growth_card_item_days_added();

drop trigger if exists growth_card_item_days_delete on public.cloud_thread_items;
create trigger growth_card_item_days_delete
  after delete on public.cloud_thread_items
  referencing old table as old_rows
  for each statement execute function private.growth_card_item_days_removed();

-- Filled once from what's there; the table is new, so this is the whole of it.
insert into private.growth_card_item_days (org_id, card_id, day, items, turns)
select i.org_id, i.card_id, (i.at at time zone 'UTC')::date, count(*)::int,
       (count(*) filter (where i.kind in ('assistant', 'user')))::int
  from public.cloud_thread_items i
 group by 1, 2, 3
on conflict (org_id, card_id, day) do nothing;

-- The account-level days, as in 20261025181950_user_active_days.sql, with the synced work read from the rollup.
create or replace function private.growth_activity(since timestamptz)
returns table (user_id uuid, day date)
language sql
stable
security definer
set search_path = ''
as $$
  -- Items of a card deleted since still count: the work happened.
  select c.owner_user, t.day
    from private.growth_card_item_days t
    join public.cloud_cards c on c.org_id = t.org_id and c.card_id = t.card_id
   where t.day >= (since at time zone 'UTC')::date and c.owner_user is not null
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

-- The in-app days, as in 20261024041130_growth_in_app_reads.sql, with the turns read from the rollup and the cards'
-- dates computed once rather than twice.
create or replace function private.growth_engagement_activity(since timestamptz)
returns table (user_id uuid, day date)
language sql
stable
security definer
set search_path = ''
as $$
  with cards as materialized (
    select d.owner_user, d.created_day, d.moved_day from private.growth_card_days() d
  )
  -- A card pushed that day.
  select c.owner_user, c.created_day
    from cards c
   where c.created_day >= (since at time zone 'UTC')::date
  union
  -- A card moved that day (columnAt is when it last changed column; the same card is counted once).
  select c.owner_user, c.moved_day
    from cards c
   where c.moved_day is not null
     and c.moved_day >= (since at time zone 'UTC')::date
  union
  -- A turn run that day: a message through the CLI.
  select c.owner_user, t.day
    from private.growth_card_item_days t
    join public.cloud_cards c on c.org_id = t.org_id and c.card_id = t.card_id
   where t.turns > 0
     and t.day >= (since at time zone 'UTC')::date
     and c.owner_user is not null;
$$;

revoke all on function private.growth_engagement_activity(timestamptz) from public, anon, authenticated;

-- In-app activity per day, as in 20261024041130_growth_in_app_reads.sql, with the cards touched, the turns and the items
-- summed from the rollup instead of counted from the items (296k of them in the last 30 days alone).
create or replace function public.growth_engagement_by_day(days int default 30)
returns table (day date, accounts int, cards int, created int, turns int, items int)
language sql
stable
security definer
set search_path = ''
as $$
  with span as (
    select greatest(1, least(coalesce(days, 30), 365)) as n, (now() at time zone 'UTC')::date as today
  ),
  since as (
    select ((span.today - span.n + 1)::timestamp at time zone 'UTC') as t from span
  ),
  series as (
    select generate_series(span.today - span.n + 1, span.today, interval '1 day')::date as d from span
  ),
  act as (
    select a.day as d, count(distinct a.user_id)::int as n
      from since, private.growth_engagement_activity(since.t) a
     group by 1
  ),
  work as (
    select t.day as d, count(*) filter (where t.items > 0)::int as touched, sum(t.turns)::int as turns, sum(t.items)::int as items
      from private.growth_card_item_days t cross join span
     where t.day >= span.today - span.n + 1
     group by 1
  ),
  made as (
    select d.created_day as d, count(*)::int as n
      from private.growth_card_days() d cross join span
     where d.created_day >= (span.today - span.n + 1)
     group by 1
  )
  select s.d, coalesce(a.n, 0), coalesce(w.touched, 0), coalesce(m.n, 0), coalesce(w.turns, 0), coalesce(w.items, 0)
    from series s
    left join act a on a.d = s.d
    left join work w on w.d = s.d
    left join made m on m.d = s.d
   order by s.d;
$$;

revoke all on function public.growth_engagement_by_day(int) from public, anon, authenticated;
grant execute on function public.growth_engagement_by_day(int) to service_role;
