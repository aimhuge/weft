-- Which repos a Mac keeps an unshared 🔐 vault for (docs/architecture/teams-vault.md, "Sharing from the team page"),
-- so the team page's project rows can say "Secrets on m5air only" from any Mac or from weft.zip, and point at the Mac
-- that has to press Share. Repo names only: no value, no key, no count of secrets. The Mac writes its own row
-- (electron/device-beat.cjs reportLocalVaults); the team page reads it through the service client for the
-- workspace's members' devices.
alter table public.devices add column if not exists local_vaults text[] not null default '{}'
  check (cardinality(local_vaults) <= 500);
grant select (local_vaults) on public.devices to authenticated;
grant update (local_vaults) on public.devices to authenticated;

-- Only the row's own user says what their Mac holds. An org admin may update a device row (to revoke it), and must
-- not be able to say a teammate's Mac holds secrets it doesn't. Roles with no session (the service role) aren't asked.
create or replace function private.devices_own_local_vaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.local_vaults is distinct from old.local_vaults and current_user in ('anon', 'authenticated')
     and (select auth.uid()) is distinct from old.user_id then
    raise exception 'Only a device''s owner says which vaults it holds.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists devices_own_local_vaults on public.devices;
create trigger devices_own_local_vaults before update on public.devices
  for each row execute function private.devices_own_local_vaults();
