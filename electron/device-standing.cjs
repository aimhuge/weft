// Where this Mac stands with the signed-in account (docs/architecture/device-registry.md, "Re-adding a Mac"), and the
// way back for one that was removed. Before this, a revoked Mac and a Mac that never registered both showed Share… in
// the 🔐 drawer, and Share… failed with nothing said (2026-11-05: m5air revoked, m1mini with no row).
//
// Standing, worked out each time the 🔐 drawer opens:
//   signed-out    no account on this Mac (the drawer already says so)
//   registered    this Mac's key has a live devices row (registered just now if it had none)
//   revoked       its row has revoked_at: removed in Settings → Devices, here or on another device
//   unregistered  signed in, no row, and registering failed (the error comes with it)
//   unknown       the read failed (offline): nothing is said, the vault's own line covers it
//
// Re-adding makes a fresh keypair: the revoked one stays distrusted on the server for good (its row's revoked_at is
// kept by a trigger). Every local vault's key is sealed to the new key before the swap, so nothing on this Mac is lost.
const fs = require("node:fs");
const path = require("node:path");
const { DEVICE_KEY_FILE, loadDeviceKey, registerDevice } = require("./device-key.cjs");

const NEXT_FILE = "device-key.next.json";
// A failed registration isn't retried on every drawer open, only after this.
const RETRY_MS = 60_000;

/** @typedef {{ state: "signed-out" | "registered" | "revoked" | "unregistered" | "unknown", error?: string, revokedAt?: string }} Standing */

// The public half straight from the file, so working out the standing never touches the Keychain.
function publicKeyIn(dir, file = DEVICE_KEY_FILE) {
  try {
    const { publicKey } = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    return typeof publicKey === "string" ? publicKey : null;
  } catch {
    return null;
  }
}

/**
 * This Mac's row for its current key, as the signed-in user reads it. null: no row. Throws on a failed read.
 * @returns {Promise<{ id: string, revoked_at: string | null } | null>}
 */
async function ownRow(accountClient, userId, publicKey) {
  const { data, error } = await accountClient.supabase.from("devices").select("id, revoked_at").eq("user_id", userId).eq("public_key", publicKey).maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/**
 * @param {{ accountClient: any, dir: string, keychain: () => { safeStorage: any, crypto: any }, now?: () => number }} deps
 * @returns {() => Promise<Standing>} reads the standing, registering a signed-in Mac that has no row
 */
// The signed-in user's id, or null when there's no account to stand with.
function signedInUser(accountClient) {
  if (!accountClient?.supabase || accountClient.signedIn?.() === false) return null;
  const sub = accountClient.getClaims?.()?.sub;
  return typeof sub === "string" ? sub : null;
}

// The standing the row alone says, or null when there's no row and registering is next.
/** @returns {Promise<Standing | null>} */
async function rowStanding(client, userId, dir) {
  const publicKey = publicKeyIn(dir);
  try {
    const row = publicKey ? await ownRow(client, userId, publicKey) : null;
    if (row?.revoked_at) return { state: "revoked", revokedAt: row.revoked_at };
    return row ? { state: "registered" } : null;
  } catch {
    return { state: "unknown" };
  }
}

function createStanding({ accountClient, dir, keychain, now = Date.now }) {
  /** @type {{ at: number, error: string } | null} */
  let failed = null;
  return async function standing() {
    const userId = signedInUser(accountClient);
    if (!userId) return { state: "signed-out" };
    const client = accountClient;
    const known = await rowStanding(client, userId, dir);
    if (known) return known;
    if (failed && now() - failed.at < RETRY_MS) return { state: "unregistered", error: failed.error };
    try {
      const keys = keychain();
      await keys.crypto.ready?.();
      await registerDevice({ accountClient: client, dir, ...keys });
      failed = null;
      return { state: "registered" };
    } catch (err) {
      failed = { at: now(), error: /** @type {Error} */ (err).message };
      return { state: "unregistered", error: failed.error };
    }
  };
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * Seal every local vault's key to the new device key too, beside the old key's copy: each grant the old key holds gets
 * a twin for the new one, for the same key version. Idempotent, so a re-add that stopped halfway picks up from here.
 * @param {{ vaultDir: string, from: { publicKey: string, privateKey: string }, to: { publicKey: string }, sodium: any }} deps
 * @returns {number} how many vault files gained a key
 */
function resealVaults({ vaultDir, from, to, sodium }) {
  if (!fs.existsSync(vaultDir)) return 0;
  let changed = 0;
  for (const name of fs.readdirSync(vaultDir).filter((f) => f.endsWith(".json"))) {
    const file = path.join(vaultDir, name);
    let vault;
    try {
      vault = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(vault?.grants)) continue;
    const have = new Set(vault.grants.filter((g) => g.device === to.publicKey).map((g) => g.keyVersion));
    const twins = vault.grants
      .filter((g) => g.device === from.publicKey && !have.has(g.keyVersion))
      .map((g) => ({ device: to.publicKey, keyVersion: g.keyVersion, wrapped: sodium.wrapKey(sodium.unwrapKey(g.wrapped, from), to.publicKey) }));
    if (!twins.length) continue;
    writeAtomic(file, JSON.stringify({ ...vault, grants: [...vault.grants, ...twins] }, null, 2));
    changed += 1;
  }
  return changed;
}

/**
 * Re-add a removed Mac: a fresh keypair, every local vault sealed to it, the old key file kept aside (sealed as it
 * was), and a new devices row. Only for a Mac whose row is revoked: a live key is never replaced from here.
 * @param {{ accountClient: any, dir: string, safeStorage: any, sodium: any, now?: () => number }} deps
 */
async function readdDevice({ accountClient, dir, safeStorage, sodium, now = Date.now }) {
  const userId = accountClient?.getClaims?.()?.sub;
  if (typeof userId !== "string") throw new Error("Sign in to Weft before re-adding this Mac.");
  await sodium.ready?.();
  const old = loadDeviceKey({ dir, safeStorage, crypto: sodium });
  const row = await ownRow(accountClient, userId, old.publicKey).catch((err) => {
    throw new Error(`This Mac's standing couldn't be read: ${err.message}`);
  });
  if (row && !row.revoked_at) throw new Error("This Mac is already on your account.");
  // No row at all (never registered, or a re-add stopped after the swap): registering is all it takes.
  if (!row) return { ...(await registerDevice({ accountClient, dir, safeStorage, crypto: sodium })), resealed: 0 };
  // The new key goes to its own file first, so a re-add cut off here starts again with the same key.
  const fresh = loadDeviceKey({ dir, safeStorage, crypto: sodium, file: NEXT_FILE });
  const resealed = resealVaults({ vaultDir: path.join(dir, "vault"), from: old, to: fresh, sodium });
  const saved = JSON.parse(fs.readFileSync(path.join(dir, DEVICE_KEY_FILE), "utf8"));
  const next = JSON.parse(fs.readFileSync(path.join(dir, NEXT_FILE), "utf8"));
  // Kept, not deleted: it's what opens any vault file this missed. It is never registered again. Copied, then replaced
  // in one rename, so there's never a moment with no device-key.json (loadDeviceKey would mint a stranger).
  fs.copyFileSync(path.join(dir, DEVICE_KEY_FILE), path.join(dir, `device-key.revoked-${now()}.json`));
  writeAtomic(path.join(dir, DEVICE_KEY_FILE), JSON.stringify({ ...next, ...(saved.name && { name: saved.name }) }, null, 2));
  fs.rmSync(path.join(dir, NEXT_FILE), { force: true });
  const device = await registerDevice({ accountClient, dir, safeStorage, crypto: sodium });
  return { ...device, resealed };
}

/**
 * The vault's standing and Re-add (electron/vault.cjs): Re-add asks for Touch ID first, and reset() drops the store
 * opened under the old key, so the next read opens it under the new one.
 * @param {{ accountClient: any, dir: string, safeStorage: any, sodium: any, prompt: (reason: string) => Promise<boolean>, now?: () => number, reset: () => void }} deps
 */
function deviceMethods({ accountClient, dir, safeStorage, sodium, prompt, now = Date.now, reset }) {
  return {
    standing: createStanding({ accountClient, dir, keychain: () => ({ safeStorage, crypto: sodium }), now }),
    async readd() {
      if (!(await prompt("re-add this Mac to your account with a new key"))) return { denied: true };
      const result = await readdDevice({ accountClient, dir, safeStorage, sodium, now });
      reset();
      return result;
    },
  };
}

module.exports = { createStanding, deviceMethods, readdDevice, resealVaults, RETRY_MS };
