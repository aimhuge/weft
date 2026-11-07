-- A team-linked repo's vault is the team's (docs/architecture/teams.md, "Shared project"; teams-vault.md, "A linked
-- repo shares its vault"). Linking a repo in Settings → Teams → Projects is what opens the repo's vault to the team's
-- Macs; unlinking it closes the vault to new ones.
--
-- vaults.grants_closed_at is set when the repo is unlinked from the vault's workspace and cleared when it is linked
-- again, by triggers on org_projects, so every path that links or unlinks (the desktop, weft.zip, a script) agrees.
-- A closed vault takes no new request and no new grant. Nothing already sealed is taken back: a Mac that holds the key
-- keeps it until an admin rotates the vault (removing a member with "Rotate shared vaults", teams-vault.md).
--
-- A vault shared from the drawer's Share… on a repo that was never linked stays open, as before: only an unlink closes.

alter table public.vaults add column if not exists grants_closed_at timestamptz;

-- Approve a teammate's Mac once, not once per vault. An admin's approval (grant_vault_device, after the fingerprint
-- check) records the Mac here with the public key that was checked. From then on any Mac that holds a team vault's key
-- seals it to the trusted Mac by itself (grant_trusted_vault_device below): new linked projects, a Mac that hasn't
-- opened one yet. The pinned key is the point: devices' "update own" policy lets an owner change public_key, so a
-- stolen session that swapped a trusted Mac's key would otherwise be sealed every vault. A changed key is no longer
-- trusted and needs an admin's approval again.
create table if not exists public.team_trusted_devices (
  org_id      uuid not null references public.orgs (id) on delete cascade,
  device_id   uuid not null references public.devices (id) on delete cascade,
  public_key  text not null,
  trusted_by  uuid references auth.users (id) on delete set null,
  trusted_at  timestamptz not null default now(),
  primary key (org_id, device_id)
);

alter table public.team_trusted_devices enable row level security;

-- Members read their team's trusted Macs (the team page's Devices). Writes go through the functions only.
create policy "team_trusted_devices: read by member" on public.team_trusted_devices
  for select to authenticated using (private.is_org_member(org_id));

-- Every Mac that holds a team vault's key today was let in by an admin or made the vault: it is trusted already.
insert into public.team_trusted_devices (org_id, device_id, public_key, trusted_by)
select distinct on (v.org_id, d.id) v.org_id, d.id, d.public_key, g.granted_by
  from public.vault_grants g
  join public.vaults v on v.id = g.vault_id
  join public.devices d on d.id = g.device_id
 where d.revoked_at is null and d.user_id is not null and g.key_version = v.current_key_version
on conflict (org_id, device_id) do nothing;

create or replace function private.org_project_vault_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.vaults set grants_closed_at = now()
     where org_id = old.org_id and repo = lower(old.repo) and grants_closed_at is null;
    return old;
  end if;
  update public.vaults set grants_closed_at = null
   where org_id = new.org_id and repo = lower(new.repo) and grants_closed_at is not null;
  return new;
end;
$$;

revoke all on function private.org_project_vault_sync() from public, anon, authenticated;

drop trigger if exists org_projects_vault_sync on public.org_projects;
create trigger org_projects_vault_sync
  after insert or delete on public.org_projects
  for each row execute function private.org_project_vault_sync();

-- As in 20261031094535_vault_device_requests.sql, with the closed check.
create or replace function private.request_vault_device(p_vault_id uuid, p_device_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_version integer;
  v_closed timestamptz;
  v_device public.devices%rowtype;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Sign in to join a vault.';
  end if;
  select org_id, current_key_version, grants_closed_at into v_org, v_version, v_closed from public.vaults where id = p_vault_id;
  if v_org is null or not private.is_org_member(v_org) then
    raise exception 'That vault isn''t in a workspace you belong to.';
  end if;
  if v_closed is not null then
    raise exception 'This project isn''t shared with the team any more, so its vault takes no new Macs.';
  end if;
  select * into v_device from public.devices where id = p_device_id and user_id = v_user and revoked_at is null;
  if v_device.id is null then
    raise exception 'The device must be one of yours.';
  end if;
  if exists (select 1 from public.vault_grants where vault_id = p_vault_id and device_id = p_device_id and key_version = v_version) then
    raise exception 'This Mac already has that vault.';
  end if;
  select id into v_id from public.pending_device_grants
   where vault_id = p_vault_id and matched_device_id = p_device_id and status = 'accepted' and expires_at > now();
  if v_id is not null then
    return v_id;
  end if;
  insert into public.pending_device_grants (vault_id, granter_user_id, target_user_id, target_fingerprint, matched_device_id, target_public_key, status, accepted_at)
    values (p_vault_id, v_user, v_user, v_device.fingerprint, p_device_id, v_device.public_key, 'accepted', now())
    returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.pending_vault_devices()
returns table (id uuid, vault_id uuid, person text, device_name text, fingerprint text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.vault_id,
         coalesce(pr.display_name, pr.name, pr.email, 'A teammate'),
         d.name, d.fingerprint, p.created_at
    from public.pending_device_grants p
    join public.vaults v on v.id = p.vault_id
    join public.devices d on d.id = p.matched_device_id
    left join public.profiles pr on pr.id = p.target_user_id
   where p.status = 'accepted'
     and p.expires_at > now()
     and v.grants_closed_at is null
     and d.revoked_at is null
     and private.is_org_role(v.org_id, 'admin')
     and not exists (
       select 1 from public.vault_grants g
        where g.vault_id = p.vault_id and g.device_id = d.id and g.key_version = v.current_key_version
     )
   order by p.created_at;
$$;

create or replace function private.grant_vault_device(p_pending_id uuid, p_wrapped_key text, p_key_version integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_pending public.pending_device_grants%rowtype;
  v_vault public.vaults%rowtype;
  v_device public.devices%rowtype;
begin
  select * into v_pending from public.pending_device_grants where id = p_pending_id for update;
  if v_pending.id is null or v_pending.status <> 'accepted' or v_pending.expires_at <= now() then
    raise exception 'That request isn''t waiting any more.';
  end if;
  select * into v_vault from public.vaults where id = v_pending.vault_id;
  if v_user is null or not private.is_org_role(v_vault.org_id, 'admin') then
    raise exception 'Only org admins can approve a device.';
  end if;
  if v_vault.grants_closed_at is not null then
    raise exception 'This project isn''t shared with the team any more. Link it again to approve new Macs.';
  end if;
  if p_key_version <> v_vault.current_key_version then
    raise exception 'This vault''s key has moved on. Pull it and try again.';
  end if;
  if not exists (
    select 1 from public.vault_grants g join public.devices d on d.id = g.device_id
     where g.vault_id = v_vault.id and g.key_version = p_key_version and d.user_id = v_user and d.revoked_at is null
  ) then
    raise exception 'This Mac doesn''t hold that vault''s key.';
  end if;
  select * into v_device from public.devices where id = v_pending.matched_device_id;
  if v_device.id is null or v_device.revoked_at is not null then
    raise exception 'That device has been revoked.';
  end if;
  if v_device.public_key is distinct from v_pending.target_public_key then
    raise exception 'That device''s key doesn''t match the one that asked.';
  end if;
  if not exists (select 1 from public.org_memberships where org_id = v_vault.org_id and user_id = v_device.user_id) then
    raise exception 'That person isn''t in the workspace any more.';
  end if;
  insert into public.vault_grants (vault_id, device_id, key_version, wrapped_key, granted_by)
    values (v_vault.id, v_device.id, p_key_version, p_wrapped_key, v_user)
    on conflict (vault_id, device_id, key_version) do nothing;
  insert into public.vault_events (vault_id, actor_user_id, actor_email, device_id, action, metadata)
    values (v_vault.id, v_user, (select email from auth.users where id = v_user), v_device.id, 'device.added', jsonb_build_object('key_version', p_key_version, 'device', v_device.name));
  -- Approved once for the team: from here on the Mac gets the team's other vaults without another approval.
  insert into public.team_trusted_devices (org_id, device_id, public_key, trusted_by)
    values (v_vault.org_id, v_device.id, v_device.public_key, v_user)
    on conflict (org_id, device_id) do update set public_key = excluded.public_key, trusted_by = excluded.trusted_by, trusted_at = now();
  delete from public.pending_device_grants where id = p_pending_id;
  return v_device.id;
end;
$$;

-- A teammate adds keys too. Any member can already write a joined vault's secrets (vault_secrets' member policies);
-- what only an admin could do is create the team's vault. For a repo the workspace has linked, any member may now
-- create it, so the first person on the team to add a key starts the shared vault. A repo that isn't linked still
-- takes an admin, as before. A closed vault (its repo unlinked) answers with its id like any existing one, and the
-- grant check below keeps it from taking a new Mac that way.
create or replace function private.share_vault(p_org_id uuid, p_repo text, p_label text, p_device_id uuid, p_wrapped_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_granter uuid := auth.uid();
  v_linked boolean;
begin
  if v_granter is null then
    raise exception 'Sign in to share a vault.';
  end if;
  v_linked := exists (select 1 from public.org_projects where org_id = p_org_id and lower(repo) = lower(p_repo));
  if not (private.is_org_role(p_org_id, 'admin') or (v_linked and private.is_org_member(p_org_id))) then
    raise exception 'Only org admins can share a vault that isn''t one of the team''s projects.';
  end if;
  if not exists (select 1 from public.devices where id = p_device_id and user_id = v_granter and revoked_at is null) then
    raise exception 'The device must be one of yours.';
  end if;
  select id into v_id from public.vaults where org_id = p_org_id and repo = p_repo;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.vaults (org_id, repo, label, created_by)
    values (p_org_id, p_repo, p_label, v_granter)
    returning id into v_id;
  insert into public.vault_grants (vault_id, device_id, key_version, wrapped_key, granted_by)
    values (v_id, p_device_id, 1, p_wrapped_key, v_granter);
  -- The Mac that made the team's vault holds its key, so it is the team's from the start.
  insert into public.team_trusted_devices (org_id, device_id, public_key, trusted_by)
    select p_org_id, d.id, d.public_key, v_granter from public.devices d where d.id = p_device_id
    on conflict (org_id, device_id) do nothing;
  return v_id;
end;
$$;

-- The gaps this caller's Macs can fill: for each open team vault one of the caller's Macs holds at its current key, the
-- trusted Macs of that team (key unchanged, not revoked, owner still in the team) with no grant at that version.
create or replace function private.trusted_vault_gaps()
returns table (vault_id uuid, key_version integer, device_id uuid, public_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.current_key_version, d.id, d.public_key
    from public.vaults v
    join public.team_trusted_devices t on t.org_id = v.org_id
    join public.devices d on d.id = t.device_id and d.public_key = t.public_key and d.revoked_at is null
   where v.grants_closed_at is null
     and private.is_org_member(v.org_id)
     and exists (select 1 from public.org_memberships m where m.org_id = v.org_id and m.user_id = d.user_id)
     and exists (
       select 1 from public.vault_grants g join public.devices mine on mine.id = g.device_id
        where g.vault_id = v.id and g.key_version = v.current_key_version and mine.user_id = auth.uid() and mine.revoked_at is null
     )
     and not exists (
       select 1 from public.vault_grants g where g.vault_id = v.id and g.device_id = d.id and g.key_version = v.current_key_version
     );
$$;

-- One gap filled: the vault key sealed, in the caller's main, to a Mac the team already trusts. No admin step: the
-- admin approved this Mac once. The caller must hold the key it seals, and the Mac's key must still be the one approved.
create or replace function private.grant_trusted_vault_device(p_vault_id uuid, p_device_id uuid, p_wrapped_key text, p_key_version integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_vault public.vaults%rowtype;
  v_device public.devices%rowtype;
begin
  select * into v_vault from public.vaults where id = p_vault_id;
  if v_user is null or v_vault.id is null or not private.is_org_member(v_vault.org_id) then
    raise exception 'That vault isn''t in a workspace you belong to.';
  end if;
  if v_vault.grants_closed_at is not null then
    raise exception 'This project isn''t shared with the team any more.';
  end if;
  if p_key_version <> v_vault.current_key_version then
    raise exception 'This vault''s key has moved on. Pull it and try again.';
  end if;
  if not exists (
    select 1 from public.vault_grants g join public.devices d on d.id = g.device_id
     where g.vault_id = v_vault.id and g.key_version = p_key_version and d.user_id = v_user and d.revoked_at is null
  ) then
    raise exception 'This Mac doesn''t hold that vault''s key.';
  end if;
  select * into v_device from public.devices where id = p_device_id and revoked_at is null;
  if v_device.id is null or not exists (
    select 1 from public.team_trusted_devices t where t.org_id = v_vault.org_id and t.device_id = v_device.id and t.public_key = v_device.public_key
  ) then
    raise exception 'That Mac needs an admin''s approval first.';
  end if;
  if not exists (select 1 from public.org_memberships where org_id = v_vault.org_id and user_id = v_device.user_id) then
    raise exception 'That person isn''t in the workspace any more.';
  end if;
  insert into public.vault_grants (vault_id, device_id, key_version, wrapped_key, granted_by)
    values (v_vault.id, v_device.id, p_key_version, p_wrapped_key, v_user)
    on conflict (vault_id, device_id, key_version) do nothing;
  insert into public.vault_events (vault_id, actor_user_id, actor_email, device_id, action, metadata)
    values (v_vault.id, v_user, (select email from auth.users where id = v_user), v_device.id, 'device.added', jsonb_build_object('key_version', p_key_version, 'device', v_device.name, 'trusted', true));
  delete from public.pending_device_grants where vault_id = v_vault.id and matched_device_id = v_device.id;
  return v_device.id;
end;
$$;

create or replace function public.trusted_vault_gaps()
returns table (vault_id uuid, key_version integer, device_id uuid, public_key text)
language sql stable security invoker set search_path = ''
as $$ select * from private.trusted_vault_gaps(); $$;

create or replace function public.grant_trusted_vault_device(p_vault_id uuid, p_device_id uuid, p_wrapped_key text, p_key_version integer)
returns uuid language sql security invoker set search_path = ''
as $$ select private.grant_trusted_vault_device(p_vault_id, p_device_id, p_wrapped_key, p_key_version); $$;

revoke all on function private.trusted_vault_gaps() from public, anon;
revoke all on function private.grant_trusted_vault_device(uuid, uuid, text, integer) from public, anon;
grant execute on function private.trusted_vault_gaps() to authenticated;
grant execute on function private.grant_trusted_vault_device(uuid, uuid, text, integer) to authenticated;
revoke all on function public.trusted_vault_gaps() from public, anon;
revoke all on function public.grant_trusted_vault_device(uuid, uuid, text, integer) from public, anon;
grant execute on function public.trusted_vault_gaps() to authenticated;
grant execute on function public.grant_trusted_vault_device(uuid, uuid, text, integer) to authenticated;

-- Someone who leaves the team (or is removed) leaves its trust behind: invited back, their Macs need an admin again.
create or replace function private.forget_trusted_devices()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.team_trusted_devices t
   using public.devices d
   where t.org_id = old.org_id and t.device_id = d.id and d.user_id = old.user_id;
  return old;
end;
$$;

revoke all on function private.forget_trusted_devices() from public, anon, authenticated;

drop trigger if exists org_memberships_forget_trusted on public.org_memberships;
create trigger org_memberships_forget_trusted
  after delete on public.org_memberships
  for each row execute function private.forget_trusted_devices();
