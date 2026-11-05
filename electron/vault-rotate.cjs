// Rotate-on-remove for a shared vault (docs/architecture/teams-vault.md, "Removal and rotation").
//
// What a rotate is: the vault's key changes. The old key is thrown away, a new one is made, and the
// new one is sealed to every device that should still have access. A device that is removed gets no
// sealed copy of the new key, so the ciphertext it can read today is worth nothing tomorrow.
//
// The rule this file exists to keep: the new vault key never leaves Electron main. It is made here,
// sealed to each remaining device's public key here, and used here to re-encrypt the values — and
// what crosses the wire is sealed boxes and ciphertext. The server never holds a key, and no value
// is ever decrypted into a context that isn't main's own memory.
//
// The split with the server (app/api/team/vaults/<id>/rotate/route.ts): this module does the crypto
// and hands back a *plan* — the new key version, the sealed key for each remaining device, and each
// value re-encrypted under the new key. The route writes the plan: the grant rows (which the RLS
// policy "vault_grants: own device insert" would refuse for a teammate's device, so the route uses
// the service client the way private.share_vault_recovery does), the key version bump, the device's
// revocation and the event row.
//
// The old wrapped keys stay in vault_grants for one cycle. A teammate who was offline at rotate
// time can still open ciphertexts that were encrypted under the old version; their first sync after
// the rotate re-encrypts those rows under the new one.
const { cryptoReady } = require("./vault-grant.cjs");

// What the event log calls a rotate. The drawer's fallback map (lib/vault-events.ts) reads it as
// "rotated the vault key".
const ROTATED_ACTION = "vault.rotated";

// The columns a secret row is read with. The ciphertext and nonce are what the re-encryption needs;
// nothing here is a value.
const SECRET_COLUMNS = "id, name, environment, ciphertext, nonce, key_version, row_version, is_blank, hint";
// The columns a grant is read with, plus the device's public key — the thing the new key is sealed to.
const GRANT_COLUMNS = "id, device_id, key_version, wrapped_key, device:devices(id, public_key, fingerprint, name, revoked_at)";

/**
 * @typedef {{ id: string, public_key?: string, fingerprint?: string, name?: string, revoked_at?: string | null }} DeviceRow
 * @typedef {{ device_id: string, key_version: number, wrapped_key: string, device?: DeviceRow | DeviceRow[] | null }} GrantRow
 * @typedef {{ id: string, name: string, environment: string, ciphertext?: string | null, nonce?: string | null, key_version: number, row_version: number, is_blank?: boolean, hint?: string | null }} SecretRow
 */

/**
 * The signed-in user's id, from the JWT's claims — never from the caller.
 * @param {{ getClaims?: () => Record<string, unknown>|null }} accountClient
 * @returns {string}
 */
function actorId(accountClient) {
  const claims = accountClient?.getClaims?.() ?? null;
  const sub = claims && typeof claims.sub === "string" ? claims.sub : null;
  if (!sub) throw new Error("Sign in to Weft to rotate a vault.");
  return sub;
}

// The device a grant row points at. Supabase returns a joined row as an object for a many-to-one
// relation and as an array for a one-to-many; this is the to-one shape, so it's an object.
function deviceOf(grant) {
  const device = grant?.device;
  if (!device) return null;
  return Array.isArray(device) ? device[0] ?? null : device;
}

/**
 * The vault's current state: the key version, every grant, and every secret row.
 *
 * @param {{ supabase: any }} db
 * @param {string} vaultId
 * @returns {Promise<{ keyVersion: number, grants: GrantRow[], secrets: SecretRow[] }>}
 */
async function readVault(db, vaultId) {
  const { data: vault, error: vaultError } = await db
    .from("vaults")
    .select("current_key_version")
    .eq("id", vaultId)
    .maybeSingle();
  if (vaultError) throw new Error(`That vault could not be read: ${vaultError.message}`);
  if (!vault) throw new Error("That vault does not exist.");

  const { data: grants, error: grantError } = await db.from("vault_grants").select(GRANT_COLUMNS).eq("vault_id", vaultId);
  if (grantError) throw new Error(`That vault's grants could not be read: ${grantError.message}`);

  const { data: secrets, error: secretError } = await db.from("vault_secrets").select(SECRET_COLUMNS).eq("vault_id", vaultId);
  if (secretError) throw new Error(`That vault's secrets could not be read: ${secretError.message}`);

  return {
    keyVersion: Number(vault.current_key_version ?? 1),
    grants: grants ?? [],
    secrets: secrets ?? [],
  };
}

/**
 * The grant this device holds for the vault: the sealed copy of the vault key that this machine can
 * open. The newest one wins, so a vault that was rotated while this machine was offline still opens.
 *
 * @param {{ supabase: any }} db
 * @param {string} vaultId
 * @param {{ id?: string, publicKey: string }} device
 * @returns {Promise<{ keyVersion: number, wrappedKey: string } | null>}
 */
async function readOwnGrant(db, vaultId, device) {
  if (!device?.publicKey) return null;
  const { data, error } = await db
    .from("vault_grants")
    .select("key_version, wrapped_key, device:devices(id, public_key, revoked_at)")
    .eq("vault_id", vaultId);
  if (error) throw new Error(`That vault's grants could not be read: ${error.message}`);
  const mine = (data ?? [])
    .map((grant) => ({ grant, device: deviceOf(grant) }))
    .filter((row) => row.device?.public_key === device.publicKey && !row.device?.revoked_at)
    .sort((a, b) => Number(b.grant.key_version) - Number(a.grant.key_version));
  const newest = mine[0];
  return newest ? { keyVersion: Number(newest.grant.key_version), wrappedKey: newest.grant.wrapped_key } : null;
}

/**
 * The names of the values the removed device could read: the ones to rotate at their providers.
 *
 * A rotate doesn't take a plaintext back from a machine that had it, so the team page has to tell
 * the admin which values to change upstream. This is a list of *names* — never a value, never a
 * ciphertext. A blank has no value to rotate, so it isn't in the list.
 *
 * @param {SecretRow[]} secrets
 * @returns {string[]} the names, each once, in the order the rows came back.
 */
function namesToRotate(secrets) {
  const seen = new Set();
  const names = [];
  for (const secret of secrets) {
    if (secret?.is_blank) continue;
    if (!secret?.name || seen.has(secret.name)) continue;
    seen.add(secret.name);
    names.push(secret.name);
  }
  return names;
}

/**
 * Rotate a shared vault's key around a removed device.
 *
 * The steps, in the order they happen:
 *
 *   1. Read the vault: its key version, every grant, every secret row.
 *   2. Open the *old* key with this device's own private half, so the values can be re-encrypted.
 *   3. Make a *new* key. The old one is now worthless to anyone who still holds it.
 *   4. Seal the new key to every device that stays: the new key version's grant, one per device.
 *   5. Re-encrypt every value under the new key, so the rows on the server are never readable with
 *      the old key. The AAD binds the new key version, so a row that kept the old version's AAD
 *      would not open even if the key leaked.
 *   6. Revoke the removed device and leave the old wrapped keys in place for one cycle, so a
 *      teammate who was offline can still read what was encrypted before the rotate.
 *
 * What comes back is the plan the route writes: sealed boxes, ciphertext, and the names to rotate at
 * their providers. The new key itself is not in it, and never leaves this function's memory.
 *
 * @param {{ vaultId: string, removedDeviceId: string, accountClient: any, device?: { id?: string, publicKey: string, privateKey?: string },
 *   sodium?: any, now?: () => number }} deps
 * @returns {Promise<{ vaultId: string, keyVersion: number, previousKeyVersion: number, revokedDeviceId: string,
 *   grants: { deviceId: string, wrappedKey: string }[], secrets: { name: string, environment: string, ciphertext: string, nonce: string, rowVersion: number }[],
 *   namesToRotate: string[], actorUserId: string }>}
 */
/**
 * The devices that stay: every granted device except the one being removed, and only the ones that
 * aren't revoked already and have a public key to seal to. The recovery device is one of them (it has
 * no user, and its grant is how a vault is recovered), so it is sealed to the new key like any other.
 *
 * @param {GrantRow[]} grants
 * @param {string} removedDeviceId
 * @returns {DeviceRow[]}
 */
function stayingDevices(grants, removedDeviceId) {
  const staying = [];
  for (const grant of grants) {
    const target = deviceOf(grant);
    if (!target) continue;
    if (target.id === removedDeviceId) continue;
    if (target.revoked_at) continue;
    if (!target.public_key) continue;
    staying.push(target);
  }
  return staying;
}

/**
 * The values, re-encrypted under the new key.
 *
 * A blank has no value to re-encrypt; it keeps its row and moves to the new version with the others,
 * so the whole vault is on one key version. A value is opened with the old key (the AAD binds the
 * version it was encrypted under) and sealed again under the new one.
 *
 * @param {SecretRow[]} secrets
 * @param {{ vaultId: string, oldKey: any, newKey: any, keyVersion: number, previousKeyVersion: number, sodium: any }} deps
 * @returns {{ name: string, environment: string, ciphertext: string, nonce: string, rowVersion: number, blank: boolean }[]}
 */
function reencryptSecrets(secrets, { vaultId, oldKey, newKey, keyVersion, previousKeyVersion, sodium }) {
  const planSecrets = [];
  for (const secret of secrets) {
    const key = Number(secret.key_version ?? previousKeyVersion);
    if (secret.is_blank || !secret.ciphertext || !secret.nonce) {
      planSecrets.push({
        name: secret.name,
        environment: secret.environment,
        ciphertext: "",
        nonce: "",
        rowVersion: Number(secret.row_version ?? 0),
        blank: true,
      });
      continue;
    }
    const value = sodium.decrypt(
      { ciphertext: secret.ciphertext, nonce: secret.nonce },
      oldKey,
      sodium.aad(vaultId, secret.name, secret.environment, key),
    );
    const fresh = sodium.encrypt(value, newKey, sodium.aad(vaultId, secret.name, secret.environment, keyVersion));
    planSecrets.push({
      name: secret.name,
      environment: secret.environment,
      ciphertext: fresh.ciphertext,
      nonce: fresh.nonce,
      rowVersion: Number(secret.row_version ?? 0),
      blank: false,
    });
  }
  return planSecrets;
}

async function rotate({ vaultId, removedDeviceId, accountClient, device, sodium, now = Date.now }) {
  if (!vaultId) throw new Error("A rotate belongs to a vault.");
  if (!removedDeviceId) throw new Error("A rotate needs the device that is being removed.");
  const db = accountClient?.supabase;
  if (!db) throw new Error("Sign in to Weft to rotate a vault.");
  const userId = actorId(accountClient);
  const sodiumModule = await cryptoReady(sodium);

  const { keyVersion: previousKeyVersion, grants, secrets } = await readVault(db, vaultId);

  // The old key, opened with this device's own half. Without it nothing can be re-encrypted, and a
  // rotate that can't re-encrypt would leave the old ciphertext readable with the old key.
  const own = await readOwnGrant(db, vaultId, device);
  if (!own) throw new Error("This device has no key for that vault, so it can't be rotated.");
  const oldKey = sodiumModule.unwrapKey(own.wrappedKey, device);

  // The new key. It is made here and goes no further than the seals below.
  const newKey = sodiumModule.newVaultKey();
  const keyVersion = previousKeyVersion + 1;

  // One sealed copy per device that stays, at the new key version.
  const planGrants = stayingDevices(grants, removedDeviceId).map((target) => ({
    deviceId: target.id,
    wrappedKey: sodiumModule.wrapKey(newKey, target.public_key),
  }));

  const planSecrets = reencryptSecrets(secrets, {
    vaultId,
    oldKey,
    newKey,
    keyVersion,
    previousKeyVersion,
    sodium: sodiumModule,
  });

  return {
    vaultId,
    keyVersion,
    previousKeyVersion,
    revokedDeviceId: removedDeviceId,
    grants: planGrants,
    secrets: planSecrets,
    // The names only: what the admin has to change at their providers.
    namesToRotate: namesToRotate(secrets),
    actorUserId: userId,
    rotatedAt: new Date(now()).toISOString(),
  };
}

/**
 * The plan, as the route's body carries it. Only the fields that cross the wire: sealed boxes,
 * ciphertext, names and ids. The actor and the timestamps stay on the server, which reads them from
 * the caller's session.
 *
 * @param {{ vaultId: string, keyVersion: number, previousKeyVersion: number, revokedDeviceId: string,
 *   grants: { deviceId: string, wrappedKey: string }[],
 *   secrets: { name: string, environment: string, ciphertext: string, nonce: string, rowVersion: number, blank?: boolean }[],
 *   namesToRotate: string[] }} plan
 */
function rotateBody(plan) {
  return {
    vaultId: plan.vaultId,
    keyVersion: Number(plan.keyVersion),
    previousKeyVersion: Number(plan.previousKeyVersion),
    revokedDeviceId: plan.revokedDeviceId,
    grants: plan.grants.map((g) => ({ deviceId: g.deviceId, wrappedKey: g.wrappedKey })),
    secrets: plan.secrets.map((s) => ({
      name: s.name,
      environment: s.environment,
      ciphertext: s.ciphertext,
      nonce: s.nonce,
      rowVersion: s.rowVersion,
      ...(s.blank ? { blank: true } : {}),
    })),
    namesToRotate: plan.namesToRotate,
  };
}

/**
 * The vaults a member's machines had a grant on, and the machines themselves.
 *
 * A rotate is per-vault, not per-workspace (docs/architecture/teams-vault.md, Q11): a member who
 * never opened two of the workspace's three vaults only rotates the one. The vault list comes from
 * the grants the member's own devices hold, so a vault the removed party could not read is not
 * rotated — and a vault whose only grant was the recovery device's (which belongs to nobody) is not
 * either.
 *
 * @param {{ supabase: any }} db
 * @param {string} userId
 * @param {string} orgId
 * @returns {Promise<{ deviceId: string, vaultIds: string[] }[]>}
 */
async function memberDevices(db, userId, orgId) {
  const { data: devices, error: deviceError } = await db.from("devices").select("id").eq("user_id", userId);
  if (deviceError) throw new Error(`That member's devices could not be read: ${deviceError.message}`);
  const ids = (devices ?? []).map((d) => d.id);
  if (ids.length === 0) return [];
  const { data: vaults, error: vaultError } = await db.from("vaults").select("id").eq("org_id", orgId);
  if (vaultError) throw new Error(`That workspace's vaults could not be read: ${vaultError.message}`);
  const vaultIds = (vaults ?? []).map((v) => v.id);
  if (vaultIds.length === 0) return [];
  const { data: grants, error: grantError } = await db
    .from("vault_grants")
    .select("device_id,vault_id")
    .in("device_id", ids)
    .in("vault_id", vaultIds);
  if (grantError) throw new Error(`That member's grants could not be read: ${grantError.message}`);
  const byDevice = new Map();
  for (const grant of grants ?? []) {
    const list = byDevice.get(grant.device_id) ?? [];
    if (!list.includes(grant.vault_id)) list.push(grant.vault_id);
    byDevice.set(grant.device_id, list);
  }
  return ids.map((id) => ({ deviceId: id, vaultIds: byDevice.get(id) ?? [] })).filter((d) => d.vaultIds.length > 0);
}

/**
 * Rotate every vault a member's machines had a grant on, around those machines.
 *
 * One plan per (vault, machine): a vault two of the removed member's machines could open is
 * rotated once for each, so neither machine keeps a copy of the new key. A vault the member's
 * machines couldn't open is not touched at all.
 *
 * The plans are computed here and returned; writing them is the caller's job (writeRotate).
 *
 * @param {{ orgId: string, userId: string, accountClient: any, device?: { id?: string, publicKey: string, privateKey?: string },
 *   sodium?: any, now?: () => number }} deps
 * @returns {Promise<{ plans: object[], namesToRotate: string[] }>}
 */
async function rotateForMember({ orgId, userId, accountClient, device, sodium, now = Date.now }) {
  if (!orgId) throw new Error("A rotate belongs to a workspace.");
  if (!userId) throw new Error("A rotate needs the member who is being removed.");
  const db = accountClient?.supabase;
  if (!db) throw new Error("Sign in to Weft to rotate a vault.");
  const sodiumModule = await cryptoReady(sodium);

  const devices = await memberDevices(db, userId, orgId);
  const plans = [];
  const names = [];
  const seen = new Set();
  for (const row of devices) {
    for (const vaultId of row.vaultIds) {
      // One plan per vault and machine: a vault two of the removed member's machines could open is
      // rotated once for each, so neither machine keeps the new key.
      const key = `${vaultId}\n${row.deviceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const plan = await rotate({
        vaultId,
        removedDeviceId: row.deviceId,
        accountClient,
        device,
        sodium: sodiumModule,
        now,
      });
      plans.push(plan);
      for (const name of plan.namesToRotate) if (!names.includes(name)) names.push(name);
    }
  }
  return { plans, namesToRotate: names };
}

// Where the rotate route lives: weft.zip, the deployed Weft. The desktop's local server has no
// service key, so the plan is written by the deployment.
const TEAMS_URL = "https://weft.zip";

/**
 * The account's access token, out of the session the account store keeps. The same token
 * electron/app-secrets-push.cjs uses to reach weft.zip; the desktop never holds a cookie for it.
 *
 * @param {{ "weft-auth"?: unknown } | null | undefined} account
 * @returns {string | null}
 */
function accessToken(account) {
  const session = account?.["weft-auth"];
  if (!session) return null;
  let parsed;
  try {
    parsed = typeof session === "string" ? JSON.parse(session) : session;
  } catch {
    return null;
  }
  const token = parsed?.access_token;
  return typeof token === "string" && token ? token : null;
}

/**
 * Write a plan to weft.zip's rotate route.
 *
 * The route writes the grants, the version bump, the re-encrypted rows, the device's revocation and
 * the event row, with the service client — the admin's own client may not write a grant for a
 * teammate's machine (the RLS policy "vault_grants: own device insert"). Only sealed boxes,
 * ciphertext and names go up; the vault key stays here.
 *
 * @param {{ plan: object, org: string, token: string, fetch?: typeof fetch, baseUrl?: string }} deps
 * @returns {Promise<{ ok: boolean, error?: string, keyVersion?: number, namesToRotate?: string[] }>}
 */
async function writeRotate({ plan, org, token, fetch: fetchImpl = globalThis.fetch, baseUrl = TEAMS_URL }) {
  if (!token) return { ok: false, error: "Sign in to your Weft account first." };
  const body = { org, ...rotateBody(plan) };
  let res;
  try {
    res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/api/team/vaults/${encodeURIComponent(plan.vaultId)}/rotate`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: `Couldn't reach weft.zip: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `weft.zip answered ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}.` };
  }
  const json = await res.json().catch(() => ({}));
  return { ok: true, keyVersion: Number(json?.keyVersion ?? plan.keyVersion), namesToRotate: json?.namesToRotate ?? plan.namesToRotate };
}

module.exports = { rotate, rotateBody, namesToRotate, readVault, readOwnGrant, memberDevices, rotateForMember, writeRotate, accessToken, ROTATED_ACTION, SECRET_COLUMNS, GRANT_COLUMNS };
