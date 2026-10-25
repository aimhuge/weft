-- What the badges need from weft.zip in one read (lib/badge-facts.ts): the caller's league weeks with their rank
-- and league size, the builders their workspaces referred, and their biggest team. Read only, the caller's own rows.

create or replace function public.badge_facts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select w.week, w.tier, w.cohort from public.league_weeks w where w.user_id = auth.uid()
  ),
  ranked as (
    select m.week, m.tier,
      (select count(*) + 1 from public.league_weeks o
        where o.week = m.week and o.tier = m.tier and o.cohort = m.cohort
          and o.xp > (select x.xp from public.league_weeks x where x.user_id = auth.uid() and x.week = m.week))::int as rank,
      (select count(*) from public.league_weeks o where o.week = m.week and o.tier = m.tier and o.cohort = m.cohort)::int as size
    from mine m
  ),
  orgs as (
    select org_id from public.org_memberships where user_id = auth.uid()
  )
  select jsonb_build_object(
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'week', r.week, 'tier', r.tier, 'rank', r.rank, 'size', r.size,
        'done', r.week < date_trunc('week', now())::date
      ) order by r.week) from ranked r
    ), '[]'::jsonb),
    'referrals', (
      select count(distinct f.referred_org_id) from public.referrals f
      where f.referrer_org_id in (select org_id from orgs) and f.status <> 'void'
    ),
    'team', coalesce((
      select max(n) from (
        select count(*) as n from public.org_memberships m where m.org_id in (select org_id from orgs) group by m.org_id
      ) t
    ), 0)
  );
$$;

revoke all on function public.badge_facts() from public, anon;
grant execute on function public.badge_facts() to authenticated;
