// Reading a local vault's file for the shared-vault flow (docs/architecture/teams-vault.md, "How a local
// vault becomes a shared one"). The file is ~/.weft/vault/<hash>.json: the vault's ciphertext rows and
// the sealed copies of its key, one per device.
//
// The key is unwrapped here, in main, and handed straight to the wrap. It is never written down, logged
// or sent anywhere: the only thing that leaves this machine is the sealed box the server stores.
//
// The file is read here rather than through electron/vault-store.cjs because the store keeps its key
// in memory and doesn't hand it out — which is the right default, and the wrong shape for a one-off
// wrap. Nothing here changes the file.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { cryptoReady } = require("./vault-grant.cjs");

/** @typedef {{ name: string, environment: string, ciphertext?: string, nonce?: string, keyVersion?: number, updatedAt: string, source?: string, hint?: string }} Entry */
/** @typedef {{ id: string, label: string, keyVersion: number, grants: { device: string, keyVersion: number, wrapped: string }[], secrets: Entry[] }} Vault */

// The same 16 hex characters the vault's file is named with (electron/vault-store.cjs).
const hashOf = (id) => crypto.createHash("sha256").update(id).digest("hex").slice(0, 16);

/**
 * The local vault's file, read.
 * @param {{ dir: string, id: string }} deps
 * @returns {Vault | null}
 */
function readVaultFile({ dir, id }) {
  const file = path.join(dir, `${hashOf(id)}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * The local vault, with its key unwrapped and its secrets as they are.
 *
 * The key comes from the grant that matches this device and the vault's current key version; a
 * rotated vault (card 9) has a grant for the newer version too, and the newest one wins.
 *
 * @param {{ dir: string, id: string, label?: string, device: { publicKey: string, privateKey: string }, sodium?: any }} deps
 * @returns {Promise<{ id: string, label: string, key: string, keyVersion: number, secrets: Entry[], localId: string }>}
 */
async function readLocalVault({ dir, id, label, device, sodium }) {
  const sodiumModule = await cryptoReady(sodium);
  const vault = readVaultFile({ dir, id });
  if (!vault) throw new Error("That vault isn't on this device yet.");
  const grant = newestGrant(vault, device.publicKey);
  if (!grant) throw new Error("This device has no key for that vault.");
  const key = sodiumModule.unwrapKey(grant.wrapped, device);
  return {
    id: vault.id,
    localId: id,
    label: label ?? vault.label,
    key,
    keyVersion: grant.keyVersion,
    secrets: Array.isArray(vault.secrets) ? vault.secrets : [],
  };
}

// This device's newest sealed copy of the vault key: the one for the highest key version.
function newestGrant(vault, publicKey) {
  const mine = (vault.grants ?? []).filter((g) => g.device === publicKey);
  if (!mine.length) return null;
  return mine.reduce((best, g) => (Number(g.keyVersion) > Number(best.keyVersion) ? g : best));
}

module.exports = { readLocalVault, readVaultFile, hashOf, newestGrant };
