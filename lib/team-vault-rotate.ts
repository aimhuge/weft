// The server's half of a shared vault's rotate (docs/architecture/teams-vault.md, "Removal and
// rotation"). The crypto is in Electron main (electron/vault-rotate.cjs): the new vault key is made
// there, sealed to the devices that stay, and used to re-encrypt the values. What arrives here is
// the *plan* — sealed boxes, ciphertext, and names.
//
// This module writes the plan. One writer, two callers: the route (app/api/team/vaults/<id>/rotate)
// and the remove-member action (lib/team-actions.ts), so a rotate that comes in through either door
// lands the same way.
//
// Why the writes run as the service client. The RLS policy "vault_grants: own device insert" only
// lets a user write a grant for a device they own — which is what makes the TOFU flow work, and
// exactly what stops an admin's desktop from granting the new key to a *teammate's* machine. The
// recovery key had the same wall (its device belongs to nobody) and the same answer: the write runs
// with the service client, the way private.share_vault_recovery does for the recovery row. The gate
// is the admin check the caller makes, and the plan's own contents are the sealed boxes the desktop
// computed.
//
// What crosses this boundary: sealed boxes (a libsodium crypto_box_seal over each device's public
// key), ciphertext, and names. Never a vault key, never a plaintext value.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// What the event log calls a rotate. The drawer's fallback map (lib/vault-events.ts) reads it as
// "rotated the vault key".
export const ROTATED_ACTION = "vault.rotated";

// One device's sealed copy of the new key.
export type RotateGrant = { deviceId: string; wrappedKey: string };

// One value, re-encrypted under the new key. A blank keeps its row and its hint, and moves to the
// new key version with the rest.
export type RotateSecret = {
  name: string;
  environment: string;
  ciphertext: string;
  nonce: string;
  rowVersion: number;
  blank?: boolean;
};

// The plan Electron main made. `previousKeyVersion` is the version the vault was on when the plan
// was computed; the vault has to still be on it when the plan lands, or the plan is stale.
export type RotatePlan = {
  vaultId: string;
  keyVersion: number;
  previousKeyVersion: number;
  revokedDeviceId: string;
  grants: RotateGrant[];
  secrets: RotateSecret[];
  // The names of the values to change at their providers. Names only — never a value.
  namesToRotate: string[];
};

export type RotateResult = { ok: true; keyVersion: number; namesToRotate: string[] } | { ok: false; error: string };

// The vault's current key version, read back so the plan can be checked against it.
async function readKeyVersion(service: SupabaseClient, vaultId: string): Promise<number | null> {
  const { data, error } = await service.from("vaults").select("current_key_version").eq("id", vaultId).maybeSingle<{ current_key_version: number }>();
  if (error) return null;
  if (!data) return null;
  return data.current_key_version;
}

// The plans that belong to one workspace, and only that workspace's.
//
// A plan names a vault, and a vault belongs to a workspace: the plan from another workspace's vault
// is refused here rather than written. This is the same rule the routes use (a vault id from another
// workspace is a 404, the same as one that doesn't exist).
export async function plansInOrg(service: SupabaseClient, orgId: string, plans: RotatePlan[]): Promise<RotatePlan[]> {
  const kept: RotatePlan[] = [];
  for (const plan of plans) {
    const { data } = await service.from("vaults").select("org_id").eq("id", plan.vaultId).maybeSingle<{ org_id: string }>();
    if (data?.org_id === orgId) kept.push(plan);
  }
  return kept;
}

// Write one plan: the new grants, the version bump, the re-encrypted rows, the device's revocation
// and the event row.
//
// The order matters. The grants go in first: a device that has no grant for the new key version
// can't open anything under it, and the removed device must not get one. Then the version bump, so
// the vault's current key version is the one the grants are for. Then the re-encrypted rows. Then
// the revocation, so the removed device can't fetch a new grant even if it tries. Then the event row.
//
// The removed device's *old* grants are left in place for one cycle: a teammate who was offline at
// rotate time can still open what was encrypted under the old version, and re-encrypts it under the
// new one on their next sync.
export async function applyRotate(service: SupabaseClient, plan: RotatePlan, actor: { userId: string; email?: string | null }): Promise<RotateResult> {
  const { vaultId, keyVersion, previousKeyVersion, revokedDeviceId, grants, secrets, namesToRotate } = plan;

  // The key version moves forward by exactly one, and it moves forward. A plan that says otherwise
  // isn't a plan we should write.
  if (keyVersion !== previousKeyVersion + 1) return { ok: false, error: "That key version doesn't follow the vault's." };

  // The vault, read back. A plan for a vault that isn't there, or for a version the vault has
  // already left, is refused: writing it would roll the vault back.
  const current = await readKeyVersion(service, vaultId);
  if (current === null) return { ok: false, error: "That vault does not exist." };
  if (previousKeyVersion !== current) return { ok: false, error: `That vault is already on key version ${current}.` };

  // The new grants: one row per device, at the new key version. The removed device is never among
  // them — the plan doesn't include it, and the filter below is the second half of that rule.
  const grantRows = grants
    .filter((g) => g.deviceId !== revokedDeviceId)
    .map((g) => ({
      vault_id: vaultId,
      device_id: g.deviceId,
      key_version: keyVersion,
      wrapped_key: g.wrappedKey,
      granted_by: actor.userId,
    }));
  if (grantRows.length !== grants.length) return { ok: false, error: "The removed device can't be granted the new key." };
  const { error: grantError } = await service.from("vault_grants").upsert(grantRows, { onConflict: "vault_id,device_id,key_version" });
  if (grantError) return { ok: false, error: `The new key could not be granted: ${grantError.message}` };

  // The key version. The vault's server_version moves with it (the trigger), so the desktop's pull
  // sees the change.
  const { error: versionError } = await service.from("vaults").update({ current_key_version: keyVersion }).eq("id", vaultId);
  if (versionError) return { ok: false, error: `The vault's key version could not be bumped: ${versionError.message}` };

  // The re-encrypted rows. A blank keeps its row and its hint, and moves to the new key version with
  // the rest; a value keeps its name and environment and gets the ciphertext the desktop computed.
  // The row_version is the one the desktop read, so a row that moved on underneath is left alone
  // rather than overwritten.
  for (const secret of secrets) {
    const { error } = await service
      .from("vault_secrets")
      .update({
        ciphertext: secret.blank ? null : secret.ciphertext,
        nonce: secret.blank ? null : secret.nonce,
        key_version: keyVersion,
        is_blank: Boolean(secret.blank),
        updated_by: actor.userId,
      })
      .eq("vault_id", vaultId)
      .eq("name", secret.name)
      .eq("environment", secret.environment)
      .eq("row_version", secret.rowVersion);
    if (error) return { ok: false, error: `${secret.name} could not be re-encrypted: ${error.message}` };
  }

  // The device is revoked. A revoked device can't fetch a new grant (the RLS on vault_grants wants
  // a non-revoked device), and it has no grant for the new key version anyway — so the unwrap would
  // fail even if it could.
  const { error: revokeError } = await service.from("devices").update({ revoked_at: new Date().toISOString() }).eq("id", revokedDeviceId);
  if (revokeError) return { ok: false, error: `That device could not be revoked: ${revokeError.message}` };

  // The event row: who rotated, which vault, and the new version. The names to rotate at their
  // providers are metadata — names, never values.
  const { error: eventError } = await service.from("vault_events").insert({
    vault_id: vaultId,
    actor_user_id: actor.userId,
    actor_email: actor.email ?? null,
    device_id: null,
    action: ROTATED_ACTION,
    target_name: null,
    target_environment: null,
    metadata: { key_version: keyVersion, previous_key_version: previousKeyVersion, removed_device_id: revokedDeviceId, names_to_rotate: namesToRotate },
  });
  if (eventError) return { ok: false, error: `The rotate could not be recorded: ${eventError.message}` };

  return { ok: true, keyVersion, namesToRotate };
}

// The devices a member owns, in one workspace's vaults.
//
// A rotate is scoped to the machine that is going away, so this is what says which devices to
// rotate around: the removed member's own devices, in the org's vaults. The recovery device has no
// user id, so it is never in here — it belongs to the vault, not to a person, and it stays.
export async function memberDevicesInOrg(service: SupabaseClient, orgId: string, userId: string): Promise<{ id: string; vaultIds: string[] }[]> {
  const { data: devices } = await service.from("devices").select("id").eq("user_id", userId);
  const ids = (devices ?? []).map((d) => d.id as string);
  if (ids.length === 0) return [];
  const { data: vaults } = await service.from("vaults").select("id").eq("org_id", orgId);
  const vaultIds = (vaults ?? []).map((v) => v.id as string);
  if (vaultIds.length === 0) return [];
  const { data: grants } = await service.from("vault_grants").select("device_id,vault_id").in("device_id", ids).in("vault_id", vaultIds);
  const byDevice = new Map<string, string[]>();
  for (const grant of grants ?? []) {
    const deviceId = grant.device_id as string;
    const list = byDevice.get(deviceId) ?? [];
    if (!list.includes(grant.vault_id as string)) list.push(grant.vault_id as string);
    byDevice.set(deviceId, list);
  }
  return ids.map((id) => ({ id, vaultIds: byDevice.get(id) ?? [] })).filter((d) => d.vaultIds.length > 0);
}

// Revoke a member's devices, without a rotate.
//
// This is the half of a rotate the server can do on its own: the machines are cut off, so no new
// grant can reach them. It is what a remove does when the key can't be turned — the browser on
// weft.zip has no Electron main, so there is nowhere to make the new key. Turning the key is still
// worth doing; until then, the plaintext the removed party held is still worth something, and the
// team page says so.
export async function revokeMemberDevices(service: SupabaseClient, orgId: string, userId: string): Promise<string[]> {
  const devices = await memberDevicesInOrg(service, orgId, userId);
  if (devices.length === 0) return [];
  const ids = devices.map((d) => d.id);
  const { error } = await service.from("devices").update({ revoked_at: new Date().toISOString() }).in("id", ids);
  if (error) throw new Error(`Those devices could not be revoked: ${error.message}`);
  return ids;
}
