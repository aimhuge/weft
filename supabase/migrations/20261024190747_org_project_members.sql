-- Project-level access inside a team: which members may see each linked project (public.org_projects). Owners and
-- admins see every project and grant the rest; a member sees only the projects granted here. A grant goes with its
-- project (unlink) and with its membership (removal or leave). Same access model as org_projects: RLS on with no
-- policies, so only the service client (lib/team-project-access.ts on the deployed Weft) reads or writes it.
create table public.org_project_members (
  org_id     uuid not null,
  repo       text not null,
  user_id    uuid not null,
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (org_id, repo, user_id),
  foreign key (org_id, repo) references public.org_projects (org_id, repo) on delete cascade,
  foreign key (org_id, user_id) references public.org_memberships (org_id, user_id) on delete cascade
);

-- "Which projects may this member see" is the snapshot's read for a member.
create index org_project_members_user_idx on public.org_project_members (org_id, user_id);

alter table public.org_project_members enable row level security;
revoke all on public.org_project_members from anon, authenticated;

-- Projects linked before this existed were visible to every member: keep it that way for them.
insert into public.org_project_members (org_id, repo, user_id)
select p.org_id, p.repo, m.user_id
from public.org_projects p
join public.org_memberships m on m.org_id = p.org_id and m.role = 'member'
on conflict do nothing;
