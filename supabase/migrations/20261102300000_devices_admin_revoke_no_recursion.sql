-- "devices: admin revoke" read vault_grants under RLS, and vault_grants' read policies read devices, so any UPDATE
-- on devices (an upsert while registering this Mac's key, pairing a worker) failed with "infinite recursion
-- detected in policy for relation devices". The check moves into a definer helper, as "devices: read shared"
-- already does with private.device_visible_to: same rule, no policy expansion through vault_grants.
create or replace function private.device_admin_revocable(p_device_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.vault_grants g
      join public.vaults v on v.id = g.vault_id
     where g.device_id = p_device_id
       and private.is_org_role(v.org_id, 'admin')
  );
$$;

revoke all on function private.device_admin_revocable(uuid) from public, anon;
grant execute on function private.device_admin_revocable(uuid) to authenticated;

drop policy if exists "devices: admin revoke" on public.devices;
create policy "devices: admin revoke" on public.devices
  for update to authenticated
  using (revoked_at is null and private.device_admin_revocable(id))
  with check (true);
