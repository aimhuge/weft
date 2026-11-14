-- Active accounts per day, as in 20261018054110_growth_reads.sql, with the items synced each day summed from
-- private.growth_card_item_days (20261114170813_growth_card_item_days.sql) instead of counted from the 374k items.
create or replace function public.growth_active_by_day(days int default 30)
returns table (day date, active int, items int)
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
      from since, private.growth_activity(since.t) a
     group by 1
  ),
  items as (
    select t.day as d, sum(t.items)::int as n
      from private.growth_card_item_days t cross join span
     where t.day >= span.today - span.n + 1
     group by 1
  )
  select s.d, coalesce(a.n, 0), coalesce(it.n, 0)
    from series s
    left join act a on a.d = s.d
    left join items it on it.d = s.d
   order by s.d;
$$;

revoke all on function public.growth_active_by_day(int) from public, anon, authenticated;
grant execute on function public.growth_active_by_day(int) to service_role;
