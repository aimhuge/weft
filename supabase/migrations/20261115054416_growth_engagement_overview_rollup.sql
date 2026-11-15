-- growth_engagement_overview counted the last 30 days' turns by scanning cloud_thread_items (~7.8 s), right at the API's
-- 8 s limit, so the Growth app's "Cards pushed · 30d" and "Working in Weft" tiles answered 500 on weft.zip. The turns
-- now come from private.growth_card_item_days (20261114170813), which keeps them per card per day: same number.
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
    select coalesce(sum(r.turns), 0)::int as n
      from private.growth_card_item_days r cross join since s
     where r.day >= s.d
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
