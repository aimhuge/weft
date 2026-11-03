// The workspace key, granted to a Weft Worker (docs/architecture/mobile-security.md#sealing-on-a-weft-worker). Settings →
// Devices → the worker → Seal…: main checks the worker is yours and its row's box key is the one it pinned
// (electron/worker-pins.cjs), asks Touch ID, then seals each version it holds to that box key (electron/worker-seal.cjs,
// purpose "workspace-key:<org>:<worker>:<version>") and signs the grant with this Mac's approval key
// (electron/desktop-signer.cjs), so the worker (lib/worker-key-grant.ts) takes it only from the Mac it pinned at pairing.
//
// Main keeps which workers it granted, sealed beside worker-pins.json, so a rotation (a phone revoked) grants them the new
// version too, and Re-pin or Revoke drops a worker's grants and rotates, as revoking a phone does. Board window only,
// over IPC (`worker-keys:*`), never the control server a thread can call.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { seal: sealTo } = require("./worker-seal.cjs");

const GRANT_DOMAIN = "weft-worker-key-v1";

/** lib/worker-key-grant.ts grantPurpose. */
const grantPurpose = (orgId, workerId, version) => `workspace-key:${orgId}:${workerId}:${version}`;

/** lib/worker-key-grant.ts grantMessage; electron/worker-key-grants.test.ts proves the two agree. */
function grantMessage({ orgId, workerId, version, boxKey, sealed }) {
  const digest = crypto.createHash("sha256").update(sealed, "utf8").digest("hex");
  return [GRANT_DOMAIN, orgId, workerId, String(version), boxKey, digest].join("\n");
}

/**
 * @param {{ dir: string, safeStorage: () => { encryptString: (s: string) => Buffer, decryptString: (b: Buffer) => string },
 *   db: () => any, userId: () => string, macDevice: () => string, sign: (message: string) => Promise<string>,
 *   pins: { pinned: (id: string) => { publicKey?: string, signKey?: string } | null },
 *   syncKeys: { current: (org: string, o?: { create?: boolean }) => Promise<any>, keyring: (org: string) => Promise<Map<number, string>>, rotate: (org: string, keep: { id: string, boxKey: string }[]) => Promise<number> },
 *   confirm: (reason: string) => Promise<boolean>, sealOn: () => boolean, keepFor: (orgId: string) => { id: string, boxKey: string }[],
 *   seal?: typeof sealTo }} deps
 */
function createWorkerKeyGrants({ dir, safeStorage, db, userId, macDevice, sign, pins, syncKeys, confirm, sealOn, keepFor, seal = sealTo }) {
  const file = path.join(dir, "vault", "worker-key-grants.json");

  /** @returns {Record<string, { orgId: string, name: string }>} */
  function read() {
    if (!fs.existsSync(file)) return {};
    try {
      const parsed = JSON.parse(safeStorage().decryptString(Buffer.from(fs.readFileSync(file, "utf8"), "base64")));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  function write(all) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, safeStorage().encryptString(JSON.stringify(all)).toString("base64"), { mode: 0o600 });
  }

  const fail = (r, what) => {
    if (r?.error && r.error.code !== "23505") throw new Error(`${what}: ${r.error.message}`);
  };

  // The worker as main's own session reads it: yours, live, and its row's box key the one this Mac pinned under Touch ID.
  async function trusted(id) {
    const r = await db().from("cloud_workers").select("id, org_id, owner_user, name, public_key, revoked_at").eq("id", id).maybeSingle();
    const row = r?.data;
    if (!row || row.owner_user !== userId() || row.revoked_at) throw new Error("That worker isn't one of yours.");
    const pin = pins.pinned(id);
    if (!pin?.signKey) throw new Error(`${row.name} was enrolled by token, so it trusts no Mac and can't take a key. Pair it from Settings → Devices first.`);
    if (!pin.publicKey) throw new Error(`This Mac hasn't pinned ${row.name}'s box key yet (Re-pin forgot it): its next secret ask pins it, then Seal again.`);
    if (pin.publicKey !== row.public_key) throw new Error(`${row.name}'s box key changed since this Mac pinned it, so it gets no key. If you reset it, Re-pin it first.`);
    return { id, orgId: row.org_id, name: row.name, boxKey: pin.publicKey };
  }

  async function grantOne(w, version, key) {
    const sealed = JSON.stringify(seal(w.boxKey, key, grantPurpose(w.orgId, w.id, version)));
    const sig = await sign(grantMessage({ orgId: w.orgId, workerId: w.id, version, boxKey: w.boxKey, sealed }));
    fail(await db().from("worker_key_grants").insert({ org_id: w.orgId, worker_id: w.id, version, box_key: w.boxKey, sealed, mac_device: macDevice(), sig }), "The worker's key couldn't be granted");
  }

  // Seal… : every version this Mac holds, so the worker opens its older sealed files too. Null when Touch ID is refused.
  async function grant(id) {
    if (!sealOn()) throw new Error("Turn on Seal synced threads in Settings → Sync first: a worker seals only while your Mac does.");
    const w = await trusted(String(id));
    if (!(await confirm(`give the worker ${w.name} the key to your sealed threads`))) return { denied: true };
    await syncKeys.current(w.orgId, { create: true });
    const ring = await syncKeys.keyring(w.orgId);
    for (const [version, key] of ring) await grantOne(w, version, key);
    write({ ...read(), [w.id]: { orgId: w.orgId, name: w.name } });
    return { version: Math.max(0, ...ring.keys()) };
  }

  // After a rotation: the new version for every worker this Mac granted in that workspace whose box key is still pinned.
  // One whose pin went (Re-pin) is dropped from the list; one that fails stays, and shows "in the clear" in Devices.
  async function regrant(orgId, version) {
    const all = read();
    const key = (await syncKeys.keyring(orgId)).get(version);
    if (!key) return;
    for (const [id, w] of Object.entries(all)) {
      if (w.orgId !== orgId) continue;
      const boxKey = pins.pinned(id)?.publicKey;
      if (!boxKey) {
        delete all[id];
        continue;
      }
      await grantOne({ id, orgId, name: w.name, boxKey }, version, key).catch(() => {});
    }
    write(all);
  }

  // Re-pin or Revoke: its grants go, and the key rotates so what's sealed after is under a version it never had.
  async function drop(id) {
    const all = read();
    const was = all[String(id)];
    fail(await db().from("worker_key_grants").delete().eq("worker_id", String(id)), "The worker's key couldn't be removed");
    if (!was) return { dropped: false };
    delete all[String(id)];
    write(all);
    const version = await syncKeys.rotate(was.orgId, keepFor(was.orgId));
    await regrant(was.orgId, version);
    return { dropped: true, version };
  }

  // For Settings → Devices: per worker, the newest version it was granted, and its workspace's newest.
  async function status() {
    const [grants, keys] = await Promise.all([
      db().from("worker_key_grants").select("worker_id, org_id, version"),
      db().from("workspace_keys").select("org_id, version"),
    ]);
    const latest = {};
    for (const k of keys?.data ?? []) latest[k.org_id] = Math.max(latest[k.org_id] ?? 0, k.version);
    /** @type {Record<string, { version: number, latest: number }>} */
    const out = {};
    for (const g of grants?.data ?? []) out[g.worker_id] = { version: Math.max(out[g.worker_id]?.version ?? 0, g.version), latest: latest[g.org_id] ?? g.version };
    return { sealOn: sealOn(), workers: out };
  }

  return { grant, regrant, drop, status, file };
}

/**
 * The IPC side, on the board-only `handle` electron/pairing-ipc.cjs passes in.
 * @param {(channel: string, fn: (...args: any[]) => unknown) => void} handle
 * @param {ReturnType<typeof createWorkerKeyGrants>} grants
 */
function registerWorkerKeyGrants(handle, grants) {
  handle("worker-keys:grant", (id) => grants.grant(String(id ?? "")));
  handle("worker-keys:drop", (id) => grants.drop(String(id ?? "")));
  handle("worker-keys:status", () => grants.status());
}

module.exports = { createWorkerKeyGrants, registerWorkerKeyGrants, grantMessage, grantPurpose, GRANT_DOMAIN };
