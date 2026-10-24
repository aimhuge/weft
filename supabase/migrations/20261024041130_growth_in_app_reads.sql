-- Growth's in-app reads: what people do *inside* Weft, and how many cards they push.
-- The companion to 20261018054110_growth_reads.sql (account-level signups, active days, weekly retention, funnel).
--
-- The account-level read counts a sign-in as activity, which flatters retention: opening the app is not the same as
-- pushing work through it. These read the work itself. Everything comes from the synced rows:
--   cloud_cards        the card JSONB (column, createdAt, columnAt, turns, stats.added/removed, cwd)
--   cloud_thread_items the transcript (kind, at, card_id)
-- Cloud sync is opt-in per folder, so these undercount the local-only work the same way the earlier reads do.
--
-- As with the earlier file, each function is revoked from public/anon/authenticated and granted to service_role alone:
-- these count across every account.

-- A card's own dates, in UTC days. The card JSONB stores epoch milliseconds (`createdAt`, `columnAt`).
-- `columnAt` is when the card last changed column; a card in the Done column has one.
create or replace function private.growth_card_days()
returns table (card_id text, owner_user uuid, created_day date, moved_day date, card_column text, turns int, added int, removed int, folder text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.card_id,
         c.owner_user,
         to_timestamp((c.card ->> 'createdAt')::bigint / 1000) at time zone 'UTC',
         to_timestamp((c.card ->> 'columnAt')::bigint / 1000) at time zone 'UTC',
         c.card ->> 'column',
         nullif(c.card ->> 'turns', '')::int,
         nullif(c.card -> 'stats' ->> 'added', '')::int,
         nullif(c.card -> 'stats' ->> 'removed', '')::int,
         c.folder
    from public.cloud_cards c
   where not c.deleted
     and c.card ->> 'createdAt' is not null
     and c.card ->> 'createdAt' ~ '^[0-9]+$'
     and c.owner_user is not null;
$$;

revoke all on function private.growth_card_days() from public, anon, authenticated;

-- The days an account did real work in Weft: it pushed a card, moved one, or ran a turn.
-- A turn is a synced thread item of kind 'assistant' or 'user' — a message through the CLI, not a tool call.
-- Called only from the functions below (as their owner), never directly.
create or replace function private.growth_engagement_activity(since timestamptz)
returns table (user_id uuid, day date)
language sql
stable
security definer
set search_path = ''
as $$
  -- A card pushed that day.
  select d.owner_user, d.created_day
    from private.growth_card_days() d
   where d.created_day >= (since at time zone 'UTC')::date
  union
  -- A card moved that day (columnAt is when it last changed column; the same card is counted once).
  select d.owner_user, d.moved_day
    from private.growth_card_days() d
   where d.moved_day is not null
     and d.moved_day >= (since at time zone 'UTC')::date
  union
  -- A turn run that day: a message through the CLI.
  select c.owner_user, (i.at at time zone 'UTC')::date
    from public.cloud_thread_items i
    join public.cloud_cards c on c.org_id = i.org_id and c.card_id = i.card_id
   where i.at >= since
     and i.kind in ('assistant', 'user')
     and c.owner_user is not null;
$$;

revoke all on function private.growth_engagement_activity(timestamptz) from public, anon, authenticated;

-- Cards pushed per day: the cards created, the cards moved, and the accounts behind them.
-- "Pushed" is a card the account created; "moved" is a card that changed column (a card that reached Done was moved).
create or replace function public.growth_cards_by_day(days int default 30)
returns table (day date, created int, moved int, accounts int, done int)
language sql
stable
security definer
set search_path = ''
as $$
  with span as (
    select greatest(1, least(coalesce(days, 30), 365)) as n, (now() at time zone 'UTC')::date as today
  ),
  series as (
    select generate_series(span.today - span.n + 1, span.today, interval '1 day')::date as d from span
  ),
  cards as (
    select * from private.growth_card_days()
  ),
  per_day as (
    select s.d,
           (select count(*)::int from cards c where c.created_day = s.d) as made,
           (select count(*)::int from cards c where c.moved_day = s.d) as moved,
           (select count(distinct c.owner_user)::int from cards c
             where c.created_day = s.d or c.moved_day = s.d) as accounts,
           (select count(*)::int from cards c where c.moved_day = s.d and c.card_column = 'done') as done
      from series s
  )
  select p.d, p.made, p.moved, p.accounts, p.done
    from per_day p
   order by p.d;
$$;

revoke all on function public.growth_cards_by_day(int) from public, anon, authenticated;
grant execute on function public.growth_cards_by_day(int) to service_role;

-- In-app activity per day: the accounts that did something in Weft (not merely signed in), the cards they touched,
-- the cards they started, the turns they ran and the thread items they wrote. `cards` counts the cards touched (a card
-- with a thread item that day), so a busy day and a quiet one are told apart the way `items` tells the account-level
-- read apart. `cards` and `created` share a scale; `turns` is in the thousands and rides in the app's tooltip.
-- The row type changed once (it gained `created`), and Postgres refuses to alter a function's return type in place.
drop function if exists public.growth_engagement_by_day(int);
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
  touched as (
    select (i.at at time zone 'UTC')::date as d, count(distinct i.card_id)::int as n
      from since, public.cloud_thread_items i
     where i.at >= since.t
     group by 1
  ),
  made as (
    select d.created_day as d, count(*)::int as n
      from private.growth_card_days() d cross join span
     where d.created_day >= (span.today - span.n + 1)
     group by 1
  ),
  turns as (
    select (i.at at time zone 'UTC')::date as d, count(*)::int as n
      from since, public.cloud_thread_items i
     where i.at >= since.t and i.kind in ('assistant', 'user')
     group by 1
  ),
  items as (
    select (i.at at time zone 'UTC')::date as d, count(*)::int as n
      from since, public.cloud_thread_items i
     where i.at >= since.t
     group by 1
  )
  select s.d, coalesce(a.n, 0), coalesce(t.n, 0), coalesce(m.n, 0), coalesce(tu.n, 0), coalesce(it.n, 0)
    from series s
    left join act a on a.d = s.d
    left join touched t on t.d = s.d
    left join made m on m.d = s.d
    left join turns tu on tu.d = s.d
    left join items it on it.d = s.d
   order by s.d;
$$;

revoke all on function public.growth_engagement_by_day(int) from public, anon, authenticated;
grant execute on function public.growth_engagement_by_day(int) to service_role;

-- In-app retention: the same weekly cohorts as public.growth_retention, but retained means the account did real work
-- in Weft that week (pushed a card, moved one, or ran a turn) rather than merely signing in. Week w of an account is
-- days [7w, 7w + 7) after its own signup day; a week appears once the cohort's first account has reached it.
create or replace function public.growth_retention_in_app(weeks int default 8)
returns table (cohort date, size int, week int, retained int)
language sql
stable
security definer
set search_path = ''
as $$
  with span as (
    select greatest(1, least(coalesce(weeks, 8), 52)) as n, (now() at time zone 'UTC')::date as today
  ),
  members as (
    select u.id,
           (u.created_at at time zone 'UTC')::date as signup,
           date_trunc('week', u.created_at at time zone 'UTC')::date as cohort
      from auth.users u
  ),
  act as (
    select a.user_id, a.day
      from private.growth_engagement_activity((select min(u.created_at) from auth.users u)) a
  ),
  cohorts as (
    select m.cohort, count(*)::int as size, min(m.signup) as first_signup from members m group by 1
  ),
  cells as (
    select c.cohort, c.size, w.w
      from cohorts c
     cross join span
     cross join lateral generate_series(0, span.n - 1) as w(w)
     where c.first_signup + 7 * w.w <= span.today
  ),
  kept as (
    select m.cohort, c.w, count(distinct m.id)::int as n
      from members m
      join cells c on c.cohort = m.cohort
      join act a on a.user_id = m.id and a.day >= m.signup + 7 * c.w and a.day < m.signup + 7 * c.w + 7
     group by 1, 2
  )
  select c.cohort, c.size, c.w, coalesce(k.n, 0)
    from cells c
    left join kept k on k.cohort = c.cohort and k.w = c.w
   order by c.cohort, c.w;
$$;

revoke all on function public.growth_retention_in_app(int) from public, anon, authenticated;
grant execute on function public.growth_retention_in_app(int) to service_role;

-- The in-app headline numbers, so the app's tiles can read them without a second round trip: the cards pushed in the
-- window, the accounts that pushed them, the cards that reached Done, and the accounts that did real work.
create or replace function public.growth_engagement_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with cards as (
    select * from private.growth_card_days()
  ),
  since as (
    select ((now() at time zone 'UTC')::date - 29)::date as d
  ),
  pushed as (
    select c.* from cards c cross join since s where c.created_day >= s.d
  ),
  movers as (
    select c.* from cards c cross join since s where c.moved_day >= s.d
  ),
  turns as (
    select count(*)::int as n
      from public.cloud_thread_items i cross join since s
     where i.at >= (s.d::timestamp at time zone 'UTC') and i.kind in ('assistant', 'user')
  ),
  engaged as (
    select count(distinct a.user_id)::int as n
      from private.growth_engagement_activity((select min(u.created_at) from auth.users u)) a
  )
  select jsonb_build_object(
    'cards_30d',        (select count(*) from pushed),
    'pushers_30d',      (select count(distinct owner_user) from pushed),
    'cards_per_pushers', (select case when count(distinct owner_user) = 0 then 0
                                       else round(count(*)::numeric / count(distinct owner_user), 1) end from pushed),
    'moved_30d',        (select count(*) from movers),
    'done_30d',         (select count(*) from movers where card_column = 'done'),
    'cards_all',        (select count(*) from cards),
    'turns_30d',        (select n from turns),
    'engaged_accounts', (select n from engaged),
    'accounts',         (select count(*) from auth.users)
  );
$$;

revoke all on function public.growth_engagement_overview() from public, anon, authenticated;
grant execute on function public.growth_engagement_overview() to service_role;
