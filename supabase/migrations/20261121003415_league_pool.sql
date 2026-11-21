-- The open league: while a week has fewer than 30 builders in all, they share one league instead of sitting alone in
-- their own tiers (two builders a tier apart each saw a league of one). Tiers stay: each builder keeps theirs, and the
-- top and bottom of the open league move up and down a tier as in any league. Once a week fills past 30, it splits back
-- into per-tier leagues of 30 as before. docs/architecture/gamification.md#the-open-league.

create or replace function private.league_pooled(p_week date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) < 30 from public.league_weeks where week = p_week;
$$;

-- As in 20261017153548_leagues.sql, except a pooled week ranks you against everyone that week.
create or replace function private.league_tier_for(p_user uuid, p_week date)
returns smallint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  prev public.league_weeks;
  pooled boolean;
  n integer;
  r integer;
  m record;
begin
  select * into prev from public.league_weeks where user_id = p_user and week < p_week order by week desc limit 1;
  if not found then
    return 0;
  end if;
  pooled := private.league_pooled(prev.week);
  select count(*) into n from public.league_weeks
    where week = prev.week and (pooled or (tier = prev.tier and cohort = prev.cohort));
  select count(*) + 1 into r from public.league_weeks
    where week = prev.week and (pooled or (tier = prev.tier and cohort = prev.cohort)) and xp > prev.xp;
  select * into m from private.league_moves(n);
  if n > 1 and prev.xp > 0 and r <= m.up and prev.tier < 5 then
    return prev.tier + 1;
  end if;
  if r > n - m.down and prev.tier > 0 then
    return prev.tier - 1;
  end if;
  return prev.tier;
end;
$$;

-- The caller's league: the whole week when it's pooled. Each row carries its own tier, and `pooled` says which it is.
drop function if exists public.league_standings(date);
create function public.league_standings(p_week date)
returns table (
  rank integer, user_id uuid, name text, avatar_url text, username text, xp integer, shipped integer,
  streak integer, level integer, badges jsonb, is_me boolean, tier smallint, size integer, pooled boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select tier, cohort, private.league_pooled(p_week) as pooled from public.league_weeks where user_id = auth.uid() and week = p_week
  ), league as (
    select w.*, mine.pooled from public.league_weeks w, mine
    where w.week = p_week and (mine.pooled or (w.tier = mine.tier and w.cohort = mine.cohort))
  )
  select
    (rank() over (order by l.xp desc))::integer,
    l.user_id,
    coalesce(nullif(p.display_name, ''), nullif(p.name, ''), 'Builder'),
    p.avatar_url,
    coalesce(to_jsonb(p)->>'username', u.raw_user_meta_data->>'user_name'),
    l.xp, l.shipped, l.streak, l.level, l.badges,
    l.user_id = auth.uid(),
    l.tier,
    (count(*) over ())::integer,
    l.pooled
  from league l
  left join public.profiles p on p.id = l.user_id
  left join auth.users u on u.id = l.user_id
  order by l.xp desc, 3;
$$;

revoke all on function public.league_standings(date) from public, anon;
grant execute on function public.league_standings(date) to authenticated;
revoke all on function private.league_pooled(date) from public, anon, authenticated;
