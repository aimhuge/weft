// The workspace sync key (docs/architecture/mobile-security.md, "Keys"): one random key per workspace and version,
// sealed to each device in public.workspace_key_grants. Main keeps the versions it has opened in
// ~/.weft/vault/sync-keys.json under safeStorage, and hands the current one to the server's uploader over the
// control server (POST /sync/key). The first Mac to seal for a workspace makes version 1.
const fs = require("node:fs");
const path = require("node:path");

/**
 * @param {{ dir: string, safeStorage: () => { encryptString: (s: string) => Buffer, decryptString: (b: Buffer) => string },
 *   crypto: () => { newVaultKey: () => string, wrapKey: (k: string, pub: string) => string, unwrapKey: (w: string, pair: { publicKey: string, privateKey: string }) => string },
 *   db: () => any, myDevice: () => Promise<{ id: string, publicKey: string, privateKey: string }> }} deps
 */
function createSyncKeys({ dir, safeStorage, crypto, db, myDevice }) {
  const file = path.join(dir, "vault", "sync-keys.json");

  /** @returns {Record<string, Record<string, string>>} */
  function readCache() {
    if (!fs.existsSync(file)) return {};
    try {
      return JSON.parse(safeStorage().decryptString(Buffer.from(fs.readFileSync(file, "utf8"), "base64")));
    } catch {
      return {};
    }
  }

  function cache(orgId, version, key) {
    const all = readCache();
    all[orgId] = { ...(all[orgId] ?? {}), [version]: key };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, safeStorage().encryptString(JSON.stringify(all)).toString("base64"), { mode: 0o600 });
  }

  const check = ({ error }, what) => {
    if (error) throw new Error(`${what}: ${error.message}`);
  };

  async function latestVersion(orgId) {
    const r = await db().from("workspace_keys").select("version").eq("org_id", orgId).order("version", { ascending: false }).limit(1);
    check(r, "The workspace key couldn't be read");
    return r.data?.[0]?.version ?? 0;
  }

  // Every version this Mac can open: the cache, plus any grant for this device it hasn't opened yet.
  /** @returns {Promise<Map<number, string>>} */
  async function keyring(orgId) {
    const ring = new Map(Object.entries(readCache()[orgId] ?? {}).map(([v, k]) => [Number(v), k]));
    const me = await myDevice();
    const r = await db().from("workspace_key_grants").select("version, wrapped_key").eq("org_id", orgId).eq("device_id", me.id);
    check(r, "The workspace key's grants couldn't be read");
    for (const g of r.data ?? []) {
      if (ring.has(g.version)) continue;
      try {
        const key = crypto().unwrapKey(g.wrapped_key, me);
        ring.set(g.version, key);
        cache(orgId, g.version, key);
      } catch {
        // A grant for another key of this device's; nothing to open.
      }
    }
    return ring;
  }

  async function grant(orgId, version, key, deviceId, boxKey) {
    const r = await db().from("workspace_key_grants").insert({ org_id: orgId, version, device_id: deviceId, wrapped_key: crypto().wrapKey(key, boxKey) });
    if (r.error && r.error.code !== "23505") check(r, "The workspace key couldn't be granted");
  }

  async function makeVersion(orgId, version) {
    const key = crypto().newVaultKey();
    check(await db().from("workspace_keys").insert({ org_id: orgId, version }), "The workspace key couldn't be made");
    const me = await myDevice();
    await grant(orgId, version, key, me.id, me.publicKey);
    cache(orgId, version, key);
    return key;
  }

  // The key to seal with: the newest version, made when the workspace has none and `create` says so; null when another
  // device holds it and hasn't granted this Mac.
  /** @returns {Promise<{ version: number, key: string } | null>} */
  async function current(orgId, { create = false } = {}) {
    const latest = await latestVersion(orgId);
    if (!latest) return create ? { version: 1, key: await makeVersion(orgId, 1) } : null;
    const key = (await keyring(orgId)).get(latest);
    return key ? { version: latest, key } : null;
  }

  // Every version this Mac holds, sealed to a newly paired device, so it can read the history too.
  async function grantAll(orgId, deviceId, boxKey) {
    for (const [version, key] of await keyring(orgId)) await grant(orgId, version, key, deviceId, boxKey);
  }

  // A new version for this Mac and the devices still paired; rows from here on are sealed with it.
  /** @param {{ id: string, boxKey: string }[]} keep */
  async function rotate(orgId, keep) {
    const version = (await latestVersion(orgId)) + 1;
    const key = await makeVersion(orgId, version);
    for (const d of keep) await grant(orgId, version, key, d.id, d.boxKey);
    return version;
  }

  return { current, keyring, grantAll, rotate, file };
}

module.exports = { createSyncKeys };
