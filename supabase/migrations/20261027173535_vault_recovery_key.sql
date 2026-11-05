-- ── The recovery key's rows ───────────────────────────────────────────────────
-- A vault's recovery key is a device row that belongs to nobody: user_id = null, name = 'recovery',
-- fingerprint = 'recovery' (docs/architecture/teams-vault.md, "Recovery key"). Its private half is the
-- 24 words the user writes down, and Weft never stores those words — not in a file, not in the server,
-- not in the event log. The server only ever holds the public half and a sealed box.
--
-- Neither of those rows can be written by an ordinary client: `devices: add own` wants
-- auth.uid() = user_id (and the recovery row has no user id), and `vault_grants: own device insert`
-- wants a device the caller owns (and the recovery row belongs to nobody). So the writes happen here,
-- in one transaction, as the function owner — the same shape as private.share_vault.
--
-- What crosses this boundary is ciphertext: the public key and the sealed box (a crypto_box_seal over
-- the recovery keypair's public half). The words never reach the database.
--
-- A re-show makes a fresh key, so the old words stop working: the old recovery device row is revoked
-- and a new one takes its place. The old grant row stays (a grant is append-only) but its device is
-- revoked, so nothing can open it any more.

create or replace function private.share_vault_recovery(
  p_vault_id    uuid,
  p_public_key  text,
  p_wrapped_key text,
  p_key_version integer default 1
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := auth.uid();
  v_org_id  uuid;
  v_device  uuid;
begin
  if v_actor is null then
    raise exception 'Sign in to use a vault''s recovery key.';
  end if;

  select v.org_id into v_org_id from public.vaults v where v.id = p_vault_id;
  if v_org_id is null then
    raise exception 'That vault does not exist.';
  end if;

  -- Membership is the gate: a member of the workspace may make the vault's recovery key, because a
  -- member of the workspace may have to use it. (An admin-only rule would strand a vault whose only
  -- admin is on holiday, which is the exact case recovery exists for.)
  if not private.is_org_member(v_org_id) then
    raise exception 'Only members of this workspace can use its recovery key.';
  end if;

  if p_public_key is null or p_public_key = '' then
    raise exception 'The recovery key has no public key.';
  end if;
  if p_wrapped_key is null or p_wrapped_key = '' then
    raise exception 'The recovery key has no sealed vault key.';
  end if;

  -- The old recovery row, if the vault already had one: revoked, so the old words stop working.
  update public.devices d
     set revoked_at = now()
   where d.id in (
     select g.device_id
       from public.vault_grants g
      where g.vault_id = p_vault_id
        and exists (select 1 from public.devices x where x.id = g.device_id and x.fingerprint = 'recovery')
   )
     and d.revoked_at is null;

  -- The recovery device: no owner, the recovery name, the marker fingerprint.
  insert into public.devices (user_id, name, public_key, fingerprint, platform, last_seen_at)
    values (null, 'recovery', p_public_key, 'recovery', 'darwin', now())
    returning id into v_device;

  -- The grant: the vault key, sealed to the recovery key. Only the words can open this.
  insert into public.vault_grants (vault_id, device_id, key_version, wrapped_key, granted_by)
    values (p_vault_id, v_device, greatest(coalesce(p_key_version, 1), 1), p_wrapped_key, v_actor);

  -- The event log's line: the key was shown, and nothing else. No words, no key material.
  insert into public.vault_events (vault_id, actor_user_id, device_id, action, metadata)
    values (p_vault_id, v_actor, v_device, 'vault.recovery_shown', jsonb_build_object('reason', null));

  return v_device;
end;
$$;

revoke all on function private.share_vault_recovery(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function private.share_vault_recovery(uuid, text, text, integer) to authenticated;
