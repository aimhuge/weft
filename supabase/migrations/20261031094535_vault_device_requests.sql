-- A teammate's Mac joining a shared vault (docs/architecture/teams-vault.md, "Joining a shared vault").
--
-- The grant was unreachable as first built: vault_grants' insert policy takes only a device the caller
-- owns, the granter's RLS can't read a device with no grant yet, and nothing wrote the row any other way.
-- These functions are that path. They carry a device's public key and a sealed box, never a vault key.
--
-- A request is a pending_device_grants row the device's owner writes for their own Mac, already
-- 'accepted': the owner is the one asking, so there is nothing left for them to accept. The admin still
-- compares the fingerprint before sealing.

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
  v_device public.devices%rowtype;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Sign in to join a vault.';
  end if;
  select org_id, current_key_version into v_org, v_version from public.vaults where id = p_vault_id;
  if v_org is null or not private.is_org_member(v_org) then
    raise exception 'That vault isn''t in a workspace you belong to.';
  end if;
  select * into v_device from public.devices where id = p_device_id and user_id = v_user and revoked_at is null;
  if v_device.id is null then
    raise exception 'The device must be one of yours.';
  end if;
  if exists (select 1 from public.vault_grants where vault_id = p_vault_id and device_id = p_device_id and key_version = v_version) then
    raise exception 'This Mac already has that vault.';
  end if;
  -- One open request per Mac and vault: asking again answers with the same one.
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

-- What an admin has to look at: the Macs waiting on the vaults they administer, with the name and
-- fingerprint to compare. The join crosses users, which RLS on devices and profiles won't.
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
     and d.revoked_at is null
     and private.is_org_role(v.org_id, 'admin')
     and not exists (
       select 1 from public.vault_grants g
        where g.vault_id = p.vault_id and g.device_id = d.id and g.key_version = v.current_key_version
     )
   order by p.created_at;
$$;

-- The admin's approval: the vault key sealed to the teammate's Mac, in the admin's own main, and stored
-- here. The caller must be able to hold the key they claim to seal, the device must still be its
-- owner's and its key the one that asked, and the owner must still be in the workspace.
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
  delete from public.pending_device_grants where id = p_pending_id;
  return v_device.id;
end;
$$;

-- An admin says no, or the Mac's owner takes the request back. Nothing was sealed, so nothing unwinds.
create or replace function private.decline_vault_device(p_pending_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pending public.pending_device_grants%rowtype;
  v_org uuid;
begin
  select * into v_pending from public.pending_device_grants where id = p_pending_id;
  if v_pending.id is null then
    return;
  end if;
  select org_id into v_org from public.vaults where id = v_pending.vault_id;
  if v_pending.target_user_id <> auth.uid() and not private.is_org_role(v_org, 'admin') then
    raise exception 'Only an admin or the Mac''s owner can decline a request.';
  end if;
  update public.pending_device_grants set status = 'declined' where id = p_pending_id;
end;
$$;

-- The public wrappers rpc() reaches, as in 20261030181901_vault_rpc_wrappers.sql: they run as the
-- caller, and every check stays in the private function.
create or replace function public.request_vault_device(p_vault_id uuid, p_device_id uuid)
returns uuid language sql security invoker set search_path = ''
as $$ select private.request_vault_device(p_vault_id, p_device_id); $$;

create or replace function public.pending_vault_devices()
returns table (id uuid, vault_id uuid, person text, device_name text, fingerprint text, created_at timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from private.pending_vault_devices(); $$;

create or replace function public.grant_vault_device(p_pending_id uuid, p_wrapped_key text, p_key_version integer)
returns uuid language sql security invoker set search_path = ''
as $$ select private.grant_vault_device(p_pending_id, p_wrapped_key, p_key_version); $$;

create or replace function public.decline_vault_device(p_pending_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.decline_vault_device(p_pending_id); $$;

revoke all on function private.request_vault_device(uuid, uuid) from public, anon;
revoke all on function private.pending_vault_devices() from public, anon;
revoke all on function private.grant_vault_device(uuid, text, integer) from public, anon;
revoke all on function private.decline_vault_device(uuid) from public, anon;
grant execute on function private.request_vault_device(uuid, uuid) to authenticated;
grant execute on function private.pending_vault_devices() to authenticated;
grant execute on function private.grant_vault_device(uuid, text, integer) to authenticated;
grant execute on function private.decline_vault_device(uuid) to authenticated;

revoke all on function public.request_vault_device(uuid, uuid) from public, anon;
revoke all on function public.pending_vault_devices() from public, anon;
revoke all on function public.grant_vault_device(uuid, text, integer) from public, anon;
revoke all on function public.decline_vault_device(uuid) from public, anon;
grant execute on function public.request_vault_device(uuid, uuid) to authenticated;
grant execute on function public.pending_vault_devices() to authenticated;
grant execute on function public.grant_vault_device(uuid, text, integer) to authenticated;
grant execute on function public.decline_vault_device(uuid) to authenticated;
