-- Cards pushed per day, split by account: the Growth app stacks each day's bar by who did the work instead of by
-- created/moved. One row per (day, account) that created or moved a card that day; quiet days have no rows and the
-- app fills them. `label` is the account's name, else its email: this read is service-role only, like every growth read.
-- Cloud sync is opt-in per folder, so this undercounts the local-only work the same way growth_cards_by_day does.
create or replace function public.growth_cards_by_account_day(days int default 30)
returns table (day date, account uuid, label text, created int, moved int, done int)
language sql
stable
security definer
set search_path = ''
as $$
  with span as (
    select greatest(1, least(coalesce(days, 30), 365)) as n, (now() at time zone 'UTC')::date as today
  ),
  cards as (
    select c.* from private.growth_card_days() c, span
     where c.owner_user is not null
       and (c.created_day > span.today - span.n or c.moved_day > span.today - span.n)
  ),
  events as (
    select owner_user, created_day as d, 1 as made, 0 as moved, 0 as done from cards
    union all
    select owner_user, moved_day, 0, 1, (card_column = 'done')::int from cards where moved_day is not null
  )
  select e.d,
         e.owner_user,
         coalesce(nullif(p.display_name, ''), nullif(p.name, ''), nullif(p.email, ''), left(e.owner_user::text, 8)),
         sum(e.made)::int,
         sum(e.moved)::int,
         sum(e.done)::int
    from events e
    cross join span
    left join public.profiles p on p.id = e.owner_user
   where e.d > span.today - span.n
   group by e.d, e.owner_user, p.display_name, p.name, p.email
   order by e.d, e.owner_user;
$$;

revoke all on function public.growth_cards_by_account_day(int) from public, anon, authenticated;
grant execute on function public.growth_cards_by_account_day(int) to service_role;
