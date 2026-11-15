-- Growth app, second pass (~/.weft/apps/growth): three reads for the reorganized dashboard.
--
--   growth_retention_in_app_days  the first week after signup, day by day: of each signup week's accounts, the share
--                                 that did real work in Weft (pushed or moved a card, ran a turn) on day d after signup.
--   growth_activation_accounts    one row per account with the activation steps it has reached, so the app can draw
--                                 the funnel on its side and list who is where. Adds a phone (the mobile app's push
--                                 registration) and a worker to the steps growth_funnel already had.
--   growth_cards_by_model         cards started per day, by account and by the model they run on.
--
-- Service-role only, like every growth read (20261018054110_growth_reads.sql): they count across every account.

create or replace function public.growth_retention_in_app_days(weeks int default 8)
returns table (cohort date, size int, day int, retained int)
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
      from auth.users u, span
     where u.created_at >= (span.today - 7 * span.n)::timestamptz
  ),
  act as (
    select distinct a.user_id, a.day
      from private.growth_engagement_activity((select min(u.created_at) from auth.users u)) a
  ),
  cohorts as (
    select m.cohort, count(*)::int as size, min(m.signup) as first_signup from members m group by 1
  ),
  cells as (
    select c.cohort, c.size, d.d
      from cohorts c
     cross join span
     cross join lateral generate_series(0, 7) as d(d)
     where c.first_signup + d.d <= span.today
  ),
  kept as (
    select m.cohort, c.d, count(distinct m.id)::int as n
      from members m
      join cells c on c.cohort = m.cohort
      join act a on a.user_id = m.id and a.day = m.signup + c.d
     group by 1, 2
  )
  select c.cohort, c.size, c.d, coalesce(k.n, 0)
    from cells c
    left join kept k on k.cohort = c.cohort and k.d = c.d
   order by c.cohort, c.d;
$$;

revoke all on function public.growth_retention_in_app_days(int) from public, anon, authenticated;
grant execute on function public.growth_retention_in_app_days(int) to service_role;

create or replace function public.growth_activation_accounts()
returns table (
  account uuid, label text, email text, created date,
  signed_in boolean, synced boolean, pushed boolean, shared boolean, trial boolean, invited boolean,
  mobile boolean, worker boolean, last_work date
)
language sql
stable
security definer
set search_path = ''
as $$
  with work as (
    select a.user_id, max(a.day) as last_day
      from private.growth_engagement_activity((select min(u.created_at) from auth.users u)) a
     group by 1
  )
  select u.id,
         coalesce(nullif(p.display_name, ''), nullif(p.name, ''), nullif(p.email, ''), u.email, left(u.id::text, 8)),
         coalesce(u.email, p.email),
         (u.created_at at time zone 'UTC')::date,
         greatest(u.last_sign_in_at, p.last_login_at) is not null,
         exists (select 1 from public.cloud_cards c where c.owner_user = u.id and not c.deleted),
         exists (select 1 from private.growth_card_days() d where d.owner_user = u.id),
         exists (select 1 from public.cloud_shares s where s.created_by = u.id),
         exists (select 1 from public.puku_trial_usage t where t.user_id = u.id and t.requests > 0),
         exists (select 1 from public.invitations i where i.invited_by = u.id),
         exists (select 1 from public.push_devices d where d.user_id = u.id),
         exists (select 1 from public.cloud_workers w where w.owner_user = u.id),
         w.last_day
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join work w on w.user_id = u.id
   order by u.created_at desc;
$$;

revoke all on function public.growth_activation_accounts() from public, anon, authenticated;
grant execute on function public.growth_activation_accounts() to service_role;

-- A card with no model runs on its CLI's default, named for the CLI so "claude default" and "codex default" stay apart.
create or replace function public.growth_cards_by_model(days int default 30)
returns table (day date, account uuid, label text, model text, cards int)
language sql
stable
security definer
set search_path = ''
as $$
  with span as (
    select greatest(1, least(coalesce(days, 30), 365)) as n, (now() at time zone 'UTC')::date as today
  ),
  cards as (
    select c.owner_user,
           (to_timestamp((c.card ->> 'createdAt')::bigint / 1000) at time zone 'UTC')::date as d,
           coalesce(nullif(c.card ->> 'model', ''), coalesce(nullif(c.card ->> 'backend', ''), 'claude') || ' default') as model
      from public.cloud_cards c
     where not c.deleted
       and c.owner_user is not null
       and c.card ->> 'createdAt' ~ '^[0-9]+$'
  )
  select c.d,
         c.owner_user,
         coalesce(nullif(p.display_name, ''), nullif(p.name, ''), nullif(p.email, ''), left(c.owner_user::text, 8)),
         c.model,
         count(*)::int
    from cards c
    cross join span
    left join public.profiles p on p.id = c.owner_user
   where c.d > span.today - span.n
   group by 1, 2, 3, 4
   order by 1, 2, 4;
$$;

revoke all on function public.growth_cards_by_model(int) from public, anon, authenticated;
grant execute on function public.growth_cards_by_model(int) to service_role;
