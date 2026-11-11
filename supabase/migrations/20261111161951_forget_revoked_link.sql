-- Forget a worker, and a revoked key row that revoked its Mac after the fact (docs/architecture/device-registry.md#a-revoked-row-linked-later).
--
-- What happened to MacBook-Air-3 and m1mini, 2026-11-02: the Mac registered a new vault key row at 16:16:36, before
-- electron/device-beat.cjs linkHost had named its host id on it. Unlinked, Settings → Devices showed it as a second
-- Mac, and it was revoked at 16:20:08 (two seconds before the old m1mini row). device_revoke revokes a Mac's heartbeat
-- row only through host_device, which was null, so the heartbeat stayed live: the revocation was of that key row only.
-- On the next launch linkHost wrote the host id onto the revoked row. From then on the database read the whole Mac as
-- revoked: cloud_workers_refuse_revoked_host refused its heartbeat, and worker_mac_state told m1mini its pairing Mac
-- was revoked, so the box put the Mac's key on mac-revoked.json for good.
--
-- 1. A revoked row's host_device never changes from a client (devices_own_host), so a later link can't widen a
--    revocation. linkHost also skips revoked rows now.
-- 2. Rows linked after they were revoked are unlinked: a revoked desktop row whose host's heartbeat row isn't revoked
--    was revoked unlinked (device_revoke would have revoked both), so the link came later.
-- 3. worker_mac_state counts only a revocation made after this worker row was paired. A re-pair (after
--    `weft-worker forget`) makes a new row, so a Mac revoked before it doesn't revoke the new pairing; one revoked
--    after it still does.
-- 4. worker_pair_open refuses a Mac that is revoked now, so a revoked Mac can't open a new pairing in the first place.

create or replace function private.devices_own_host()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.host_device is distinct from old.host_device and current_user in ('anon', 'authenticated') then
    if (select auth.uid()) is distinct from old.user_id then
      raise exception 'Only a device''s owner names its host.' using errcode = '42501';
    end if;
    if old.revoked_at is not null then
      raise exception 'A revoked device''s host stays as it was.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

update public.devices d
   set host_device = null
 where d.kind = 'desktop' and d.revoked_at is not null and d.host_device is not null
   and not exists (
     select 1 from public.cloud_workers w
      where w.kind = 'desktop' and w.owner_user = d.user_id and w.device = d.host_device and w.revoked_at is not null);

-- Whether a Mac (by its host id) is revoked, optionally only by a revocation at or after `p_since`.
create or replace function private.mac_revoked(p_owner uuid, p_mac text, p_since timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.cloud_workers d
                  where d.kind = 'desktop' and d.owner_user = p_owner and d.device = p_mac and d.revoked_at is not null
                    and (p_since is null or d.revoked_at >= p_since))
      or exists (select 1 from public.devices k
                  where k.kind = 'desktop' and k.user_id = p_owner and k.host_device = p_mac and k.revoked_at is not null
                    and (p_since is null or k.revoked_at >= p_since));
$$;

revoke all on function private.mac_revoked(uuid, text, timestamptz) from public, anon, authenticated;

create or replace function public.worker_mac_state(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
begin
  if w.paired_mac is null then
    return jsonb_build_object('mac', null, 'revoked', false);
  end if;
  -- The row was made by the pairing (worker_pair_confirm), so its created_at is when the box chose this Mac.
  return jsonb_build_object('mac', w.paired_mac, 'revoked', private.mac_revoked(w.owner_user, w.paired_mac, w.created_at));
end;
$$;

revoke all on function public.worker_mac_state(text) from public;
grant execute on function public.worker_mac_state(text) to anon, authenticated;

create or replace function public.worker_pair_open(p_org uuid, p_mac_device text, p_mac_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  pid uuid;
begin
  if uid is null or not private.is_org_member(p_org) then
    raise exception 'not a member of that workspace' using errcode = '42501';
  end if;
  if p_mac_device is not null and private.mac_revoked(uid, p_mac_device, null) then
    raise exception 'This Mac was revoked, so it can''t pair a worker.' using errcode = '42501';
  end if;
  insert into public.phone_pairings (user_id, org_id, mac_device, mac_key, purpose, expires_at)
    values (uid, p_org, p_mac_device, p_mac_key, 'worker', now() + interval '1 hour')
    returning id into pid;
  return pid;
end;
$$;
