-- Which of the caller's teams linked each of these repos (public.org_projects), so a Mac files a synced folder's cards
-- under the team that owns its project instead of its owner's personal workspace (lib/cloud-sync-route.ts).
-- org_projects stays service-role only: this answers only for the repos asked about and only in teams the caller is a
-- member of, so it never lists a team's other projects. A repo linked in several of them goes to the oldest link.
create or replace function public.team_orgs_for_repos(repos text[])
returns table (repo text, org_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (lower(p.repo)) p.repo, p.org_id
  from public.org_projects p
  where lower(p.repo) in (select lower(r) from unnest(repos) as r)
    and private.is_org_member(p.org_id)
  order by lower(p.repo), p.created_at
$$;

revoke all on function public.team_orgs_for_repos(text[]) from public, anon;
grant execute on function public.team_orgs_for_repos(text[]) to authenticated;
