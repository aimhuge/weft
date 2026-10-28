// A shared vault's server side in Electron main: the first grant on a new vault, and a grant to a
// device that joined later (docs/architecture/teams-vault.md, "How a local vault becomes a shared one"
// and "Granting a teammate's devices").
//
// Two writes reach the server here, and both carry ciphertext only:
//
//   private.share_vault(org, repo, label, device, wrapped_key)  the vault row and its first grant,
//     in one transaction. The wrapped key is computed in main first, because the function can't:
//     a sealed box needs the vault key, and the vault key never goes to the server.
//   vault_grants                                            one row per device × key version, for a
//     device that joined after the vault existed.
//
// The vault key stays in main. What leaves is a `crypto_box_seal` box the target device alone can
// open, and the names of the secrets — never a value.

const { wrapForDevice, cryptoReady } = require("./vault-grant.cjs");

/** @typedef {{ id?: string, publicKey: string, privateKey?: string }} Device */
/** @typedef {{ name: string, environment: string, ciphertext?: string, nonce?: string, keyVersion?: number, hint?: string }} Secret */
/** @typedef {{ id: string, key: string, keyVersion?: number, secrets?: Secret[] }} SharedVault */

// The user id the server records the grant under. It comes from the JWT's claims, never from the
// caller, so a grant can't be written in somebody else's name.
/** @returns {string} */
function actorId(accountClient) {
  const claims = accountClient?.getClaims?.() ?? null;
  const sub = claims && typeof claims.sub === "string" ? claims.sub : null;
  if (!sub) throw new Error("Sign in to Weft before sharing a vault.");
  return sub;
}

// The pending grant, read back: the row says which vault, which fingerprint the granter was sent,
// and — once the other side accepted — which device was matched and what its public key is.
async function readPending(accountClient, pendingId) {
  const { data, error } = await accountClient.supabase
    .from("pending_device_grants")
    .select("id, vault_id, granter_user_id, target_user_id, target_fingerprint, matched_device_id, target_public_key, status")
    .eq("id", pendingId)
    .maybeSingle();
  if (error) throw new Error(`That grant could not be read: ${error.message}`);
  return data ?? null;
}

/**
 * The granter's side of a TOFU handshake: seal this vault's key to the device that accepted, and
 * write the grant row.
 *
 * The pending row is the source of the target's public key — it was written by the accepting side,
 * which read it from the `devices` table and never from a request body. The granter's main re-reads
 * it here rather than trusting anything the board hands it, and re-checks that the public key is
 * really that device's, so a server that substituted a key of its own is caught before the vault
 * key is sealed to it.
 *
 * @param {{ accountClient: any, pendingId: string, vault: SharedVault, device: Device, sodium?: any }} deps
 */
async function grantPendingDevice({ accountClient, pendingId, vault, device, sodium }) {
  await cryptoReady(sodium);
  const pending = await readPending(accountClient, pendingId);
  if (!pending) throw new Error("That grant isn't waiting any more.");
  if (pending.status !== "accepted") throw new Error("That device hasn't accepted the grant yet.");
  if (pending.vault_id !== vault.id) throw new Error("That grant is for another vault.");
  if (!pending.target_public_key) throw new Error("That grant has no public key to seal the key to.");

  // The public key has to be the matched device's own. The pending row carries a device id, so the
  // devices table is the authority: a key that isn't there isn't the device's.
  const { data: matched, error } = await accountClient.supabase
    .from("devices")
    .select("id, public_key, fingerprint, name, revoked_at")
    .eq("id", pending.matched_device_id)
    .maybeSingle();
  if (error) throw new Error(`That device could not be read: ${error.message}`);
  if (!matched) throw new Error("That device isn't registered.");
  if (matched.revoked_at) throw new Error("That device has been revoked.");
  if (matched.public_key !== pending.target_public_key) throw new Error("That device's key doesn't match the one that was accepted.");

  const { wrappedKey, keyVersion } = wrapForDevice({ vault, granterDevice: device, newDevice: { id: matched.id, publicKey: matched.public_key } });
  await writeGrant({ accountClient, vaultId: vault.id, deviceId: matched.id, wrappedKey, keyVersion, grantedBy: actorId(accountClient) });
  return { deviceId: matched.id, keyVersion, fingerprint: matched.fingerprint, name: matched.name };
}

/**
 * The grant row itself: one row per (vault, device, key version). The server refuses a second one
 * for the same three, so a repeat grant is a no-op rather than an error.
 */
async function writeGrant({ accountClient, vaultId, deviceId, wrappedKey, keyVersion, grantedBy }) {
  const row = { vault_id: vaultId, device_id: deviceId, key_version: keyVersion, wrapped_key: wrappedKey, granted_by: grantedBy };
  const { error } = await accountClient.supabase.from("vault_grants").upsert(row, { onConflict: "vault_id,device_id,key_version" });
  if (error) throw new Error(`That device could not be granted: ${error.message}`);
  return row;
}

/**
 * Share a local vault for the first time: the vault row, the first grant (to this device), and the
 * local secrets imported as the server's rows.
 *
 * The local vault key is *kept* as version 1 of the shared vault's key. A teammate who joins later
 * gets that same key sealed to their own public key, not a new one — so the values already in the
 * vault stay readable to them.
 *
 * The local file becomes a shadow from here on: <hash>.shared.json says which server vault it is,
 * and the sync engine (electron/vault-sync.cjs) takes it from there.
 *
 * @param {{ accountClient: any, orgId: string, repo: string, label?: string, device: Device,
 *   vault: SharedVault, sodium?: any,
 *   markShared?: (id: string, value: { orgId: string, vaultId: string, repo: string, keyVersion: number }) => void,
 *   checkRepo?: (repo: string) => Promise<boolean> }} deps
 */
async function shareLocalVault({ accountClient, orgId, repo, label, device, vault, markShared, checkRepo, sodium }) {
  await cryptoReady(sodium);
  if (!orgId) throw new Error("Pick a workspace to share this vault with.");
  const name = String(repo ?? "").trim().toLowerCase();
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(name)) throw new Error(`${repo} isn't a GitHub repo name like owner/name.`);
  // A typo would lock the vault to a misspelled name that never matches a real repo, so the check
  // is one request and saves a rename later.
  if (checkRepo && !(await checkRepo(name))) throw new Error(`${name} isn't a GitHub repository.`);

  // The wrapped key is computed here, before the call: the function is security definer and can't
  // seal anything, and the vault key never goes to the server.
  const { wrappedKey, keyVersion } = wrapForDevice({ vault, granterDevice: device, newDevice: { id: device.id ?? null, publicKey: device.publicKey } });

  const { data: vaultId, error } = await accountClient.supabase.rpc("share_vault", {
    p_org_id: orgId,
    p_repo: name,
    p_label: label ?? name,
    p_device_id: device.id,
    p_wrapped_key: wrappedKey,
  });
  if (error) throw new Error(`This vault could not be shared: ${error.message}`);
  if (!vaultId) throw new Error("This vault could not be shared.");

  // The local secrets become the server's rows. They are already ciphertext under the same key
  // (the local key was kept as version 1), so only the row's shape changes.
  await importSecrets({ accountClient, vaultId, secrets: vault.secrets ?? [], keyVersion, userId: actorId(accountClient) });

  // From here on the local file is a shadow of the server.
  markShared?.(vault.id, { orgId, vaultId, repo: name, keyVersion });
  return { vaultId, repo: name, keyVersion, orgId };
}

// The local secrets as the server's rows: the same ciphertext and nonce, under the same key.
async function importSecrets({ accountClient, vaultId, secrets, keyVersion, userId }) {
  const rows = secrets
    .filter((s) => s && typeof s.name === "string" && typeof s.environment === "string")
    .map((s) => ({
      vault_id: vaultId,
      name: s.name,
      environment: s.environment,
      ciphertext: s.ciphertext ?? null,
      nonce: s.nonce ?? null,
      key_version: Number(s.keyVersion ?? keyVersion),
      is_blank: !s.ciphertext,
      hint: s.hint ?? null,
      updated_by: userId,
    }));
  if (!rows.length) return 0;
  const { error } = await accountClient.supabase.from("vault_secrets").upsert(rows, { onConflict: "vault_id,name,environment" });
  if (error) throw new Error(`This vault's secrets could not be shared: ${error.message}`);
  return rows.length;
}

module.exports = { grantPendingDevice, shareLocalVault, readPending, writeGrant, importSecrets, actorId };
