-- Team agents (docs/architecture/agents.md): an agent one member made in Settings → Agents, shared with a Weft team, so
-- every member's Weft offers it in its pickers. Same shape as cloud_app_shares: members read, the sharer writes their own
-- rows, and a team admin may also take one down. The desktop writes as the signed-in user (lib/team-agents.ts), so RLS
-- is the whole gate.

create table public.team_agents (
  org_id uuid not null references public.orgs (id) on delete cascade,
  -- The agent's id on the sharer's Mac (lib/agent-store.ts createAgent: a-<8 hex>).
  agent_id text not null check (agent_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  name text not null check (char_length(name) between 1 and 40),
  emoji text not null default '🤖' check (char_length(emoji) between 1 and 8),
  tagline text not null default '' check (char_length(tagline) <= 140),
  soul text not null check (char_length(soul) between 1 and 20000),
  skills_off text[] not null default '{}' check (cardinality(skills_off) <= 500),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, agent_id)
);

create index team_agents_created_by_idx on public.team_agents (created_by);

create trigger team_agents_touch_updated_at before update on public.team_agents
  for each row execute function private.touch_updated_at();

alter table public.team_agents enable row level security;
revoke all on public.team_agents from anon, authenticated;

create policy "team_agents: read as member" on public.team_agents
  for select to authenticated using (private.is_org_member(org_id));

create policy "team_agents: insert own" on public.team_agents
  for insert to authenticated with check (created_by = (select auth.uid()) and private.is_org_member(org_id));

create policy "team_agents: update own" on public.team_agents
  for update to authenticated using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()) and private.is_org_member(org_id));

-- The sharer takes theirs down; a team admin can too (someone who left, a soul the team doesn't want).
create policy "team_agents: delete own or as admin" on public.team_agents
  for delete to authenticated using (created_by = (select auth.uid()) or private.is_org_role(org_id, 'admin'));

-- created_by is left out of the writes, so it is always auth.uid().
grant select (org_id, agent_id, name, emoji, tagline, soul, skills_off, created_by, created_at, updated_at)
  on public.team_agents to authenticated;
grant insert (org_id, agent_id, name, emoji, tagline, soul, skills_off) on public.team_agents to authenticated;
grant update (name, emoji, tagline, soul, skills_off) on public.team_agents to authenticated;
grant delete on public.team_agents to authenticated;
