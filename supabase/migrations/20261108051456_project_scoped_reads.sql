-- Project access reaches synced cards and the shared vault (docs/architecture/teams.md#project-access). Until now a grant
-- (org_project_members) only decided which projects the team page listed: every card, thread item, tool output and
-- linked vault read as "any member of the workspace". Now a team's card reads for its owner, the workspace's owners and
-- admins, and members granted its repo; a workspace of one (a personal workspace) is unchanged. Repos compare without
-- case, since org_projects keeps GitHub's casing (Exitingcom/exitingcom) and cloud_cards.repo is lowercased.
--
-- Everything that reads cards as a signed-in user goes through RLS (the desktop's team board, the web board, the phone,
-- Realtime), so it all follows. The SECURITY DEFINER readers either return only the caller's own cards (worker_*,
-- card_owned_by_caller) or are service-only (growth_*, admin_*, infra_live). Writes are unchanged: each row is its
-- owner's already. Blobs stay per workspace: they're stored by sha256, so fetching one needs an item that names it.

-- Can this user see work in this repo of this workspace? The one check cards, routing and the vault share.
create function private.can_use_repo(p_org uuid, p_repo text, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.org_memberships m where m.org_id = p_org and m.user_id = p_user)
     and (
          exists (select 1 from public.org_memberships m where m.org_id = p_org and m.user_id = p_user and m.role in ('admin', 'owner'))
       or (select count(*) from public.org_memberships m where m.org_id = p_org) = 1
       or (p_repo is not null and exists (
             select 1 from public.org_project_members g
              where g.org_id = p_org and lower(g.repo) = lower(p_repo) and g.user_id = p_user))
     );
$$;

-- A card row: yours, or one whose repo you can use. A team card with no repo (or a repo since unlinked) is its
-- owner's and the admins'.
create function private.can_read_card(p_org uuid, p_repo text, p_owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_owner = (select auth.uid()) or private.can_use_repo(p_org, p_repo, (select auth.uid()));
$$;

-- The rows hung off a card (thread items, tool outputs, commands, shares, takeovers) read as their card does, through
-- an EXISTS on cloud_cards written into each policy rather than a per-row function: the planner joins it once, so a
-- 9,556-item thread reads in ~5 ms (a function per row took ~1 s; the old is_org_member policy ~130-390 ms). The card
-- check leads with owner_user = auth.uid(), so your own cards never reach the function (1,702 cards: ~2 ms, was ~25).

revoke all on function private.can_use_repo(uuid, text, uuid) from public, anon;
revoke all on function private.can_read_card(uuid, text, uuid) from public, anon;
grant execute on function private.can_use_repo(uuid, text, uuid) to authenticated;
grant execute on function private.can_read_card(uuid, text, uuid) to authenticated;

-- Cards and what hangs off them.
drop policy "cloud_cards: read as member" on public.cloud_cards;
create policy "cloud_cards: read by project" on public.cloud_cards
  for select to authenticated using (owner_user = (select auth.uid()) or private.can_read_card(org_id, repo, owner_user));

drop policy "cloud_thread_items: read as member" on public.cloud_thread_items;
create policy "cloud_thread_items: read by project" on public.cloud_thread_items
  for select to authenticated using (exists (
    select 1 from public.cloud_cards c
     where c.org_id = cloud_thread_items.org_id and c.card_id = cloud_thread_items.card_id
       and (c.owner_user = (select auth.uid()) or private.can_read_card(c.org_id, c.repo, c.owner_user))));

drop policy "cloud_tool_outputs: read as member" on public.cloud_tool_outputs;
create policy "cloud_tool_outputs: read by project" on public.cloud_tool_outputs
  for select to authenticated using (exists (
    select 1 from public.cloud_cards c
     where c.org_id = cloud_tool_outputs.org_id and c.card_id = cloud_tool_outputs.card_id
       and (c.owner_user = (select auth.uid()) or private.can_read_card(c.org_id, c.repo, c.owner_user))));

-- A command carries a prompt or a reply for its card. Your own always read; one without a card (a new thread in a
-- folder) reads as before.
drop policy "cloud_commands: read as member" on public.cloud_commands;
create policy "cloud_commands: read by project" on public.cloud_commands
  for select to authenticated using (
    private.is_org_member(org_id)
    and (kind <> all (array['secret_use', 'login', 'github_login', 'vault_keep']) or (select auth.uid()) = created_by)
    and ((select auth.uid()) = created_by or card_id is null or exists (
    select 1 from public.cloud_cards c
     where c.org_id = cloud_commands.org_id and c.card_id = cloud_commands.card_id
       and (c.owner_user = (select auth.uid()) or private.can_read_card(c.org_id, c.repo, c.owner_user))))
  );

drop policy "cloud_shares: read as member" on public.cloud_shares;
create policy "cloud_shares: read by project" on public.cloud_shares
  for select to authenticated using (
    private.is_org_member(org_id) and ((select auth.uid()) = created_by or exists (
    select 1 from public.cloud_cards c
     where c.org_id = cloud_shares.org_id and c.card_id = cloud_shares.card_id
       and (c.owner_user = (select auth.uid()) or private.can_read_card(c.org_id, c.repo, c.owner_user))))
  );

drop policy "cloud_card_takeovers: read as member" on public.cloud_card_takeovers;
create policy "cloud_card_takeovers: read by project" on public.cloud_card_takeovers
  for select to authenticated using (
    private.is_org_member(org_id)
    and ((select auth.uid()) in (by_user, owner_user) or exists (
    select 1 from public.cloud_cards c
     where c.org_id = cloud_card_takeovers.org_id and c.card_id = cloud_card_takeovers.card_id
       and (c.owner_user = (select auth.uid()) or private.can_read_card(c.org_id, c.repo, c.owner_user))))
  );

-- Routing: a repo goes to the team only for someone who can use it there, so a member not granted a project keeps
-- that checkout's cards in their own workspace (lib/cloud-sync-route.ts), and their Mac doesn't ask for its vault.
create or replace function public.team_orgs_for_repos(repos text[])
returns table (repo text, org_id uuid) language sql stable security definer set search_path = '' as $$
  select distinct on (lower(p.repo)) p.repo, p.org_id
  from public.org_projects p
  where lower(p.repo) in (select lower(r) from unnest(repos) as r)
    and private.can_use_repo(p.org_id, p.repo, (select auth.uid()))
  order by lower(p.repo), p.created_at
$$;

-- The shared vault: a linked repo's key is sealed only to Macs whose person can use the repo. A vault with no repo
-- reads as before. The key holder's Mac is told which trusted Macs to seal (trusted_vault_gaps); the seal, an ask and an
-- admin's approval each refuse anyone else.
create or replace function private.trusted_vault_gaps()
returns table (vault_id uuid, key_version integer, device_id uuid, public_key text)
language sql stable security definer set search_path = '' as $$
  select v.id, v.current_key_version, d.id, d.public_key
    from public.vaults v
    join public.team_trusted_devices t on t.org_id = v.org_id
    join public.devices d on d.id = t.device_id and d.public_key = t.public_key and d.revoked_at is null
   where v.grants_closed_at is null
     and private.is_org_member(v.org_id)
     and exists (select 1 from public.org_memberships m where m.org_id = v.org_id and m.user_id = d.user_id)
     and (v.repo is null or private.can_use_repo(v.org_id, v.repo, d.user_id))
     and exists (
       select 1 from public.vault_grants g join public.devices mine on mine.id = g.device_id
        where g.vault_id = v.id and g.key_version = v.current_key_version and mine.user_id = auth.uid() and mine.revoked_at is null
     )
     and not exists (
       select 1 from public.vault_grants g where g.vault_id = v.id and g.device_id = d.id and g.key_version = v.current_key_version
     );
$$;

-- Raises when this person can't use the vault's repo: an ask to join (below) says why.
create function private.require_vault_access(p_vault_id uuid, p_user uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_vault public.vaults%rowtype;
begin
  select * into v_vault from public.vaults where id = p_vault_id;
  if v_vault.repo is not null and not private.can_use_repo(v_vault.org_id, v_vault.repo, p_user) then
    raise exception 'That person doesn''t have access to % in this team. An admin can give it on the team page.', v_vault.repo;
  end if;
end;
$$;
revoke all on function private.require_vault_access(uuid, uuid) from public, anon;
grant execute on function private.require_vault_access(uuid, uuid) to authenticated;

-- The checks go in a BEFORE INSERT trigger on vault_grants and pending_device_grants rather than in each writer's body,
-- so grant_trusted_vault_device, grant_vault_device, request_vault_device, share_vault and the rotation
-- (lib/team-vault-rotate.ts) keep their text untouched and a future writer can't skip it. The row's person decides:
-- - an ask (pending_device_grants) from someone without the project raises, with what to do about it;
-- - a key (vault_grants) for their Mac is dropped without a word, so a rotation after a grant is taken away completes
--   and simply leaves that Mac out, rather than failing the whole batch.
create function private.vault_grant_access_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_vault public.vaults%rowtype;
begin
  if tg_table_name = 'vault_grants' then
    select d.user_id into v_user from public.devices d where d.id = new.device_id;
  else
    v_user := new.target_user_id;
  end if;
  -- A recovery key has no person behind it; it's guarded where it's made (share_vault_recovery).
  if v_user is null then
    return new;
  end if;
  if tg_table_name = 'pending_device_grants' then
    perform private.require_vault_access(new.vault_id, v_user);
    return new;
  end if;
  select * into v_vault from public.vaults where id = new.vault_id;
  if v_vault.repo is not null and not private.can_use_repo(v_vault.org_id, v_vault.repo, v_user) then
    return null;
  end if;
  return new;
end;
$$;

create trigger vault_grants_access_check before insert on public.vault_grants
  for each row execute function private.vault_grant_access_check();
create trigger pending_device_grants_access_check before insert on public.pending_device_grants
  for each row execute function private.vault_grant_access_check();
