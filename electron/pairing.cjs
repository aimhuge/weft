// Pairing a phone or a browser with this Mac (docs/architecture/mobile-security.md, "Pairing"): main makes the code,
// keeps its secret in memory only, checks the claim the device writes back, asks Touch ID, then pins the device,
// adds its public.devices row and seals the workspace key to it. Revoking unpins first (that alone stops its
// approvals), then drops its grants, marks it revoked and rotates the key. Started over IPC from the board only
// (electron/pairing-ipc.cjs): a thread that could pair would approve itself.
const { checkClaim, newSecret, pairingLink } = require("./pairing-crypto.cjs");
const { fingerprint } = require("./device-fingerprint.cjs");

const TTL_MS = 5 * 60_000;

/**
 * @param {{ db: () => any, userId?: () => string, sodium: () => any, macDevice: () => string, myDevice: () => Promise<{ id: string, publicKey: string }>,
 *   paired: ReturnType<typeof import("./paired-devices.cjs").createPairedDevices>, syncKeys: ReturnType<typeof import("./sync-keys.cjs").createSyncKeys>,
 *   confirm: (reason: string) => Promise<boolean>, now?: () => number }} deps
 */
function createPairing({ db, userId = () => "", sodium, macDevice, myDevice, paired, syncKeys, confirm, now = Date.now }) {
  /** @type {Map<string, { secret: string, orgId: string, expiresAt: number }>} */
  const open = new Map();

  const fail = (r, what) => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    return r.data;
  };

  // The workspace synced cards go to: the user's first owned org, as lib/cloud-sync.ts resolveOrgId picks it.
  async function workspace() {
    const r = await db().from("org_memberships").select("org_id").eq("user_id", userId()).eq("role", "owner").order("created_at", { ascending: true }).limit(1).maybeSingle();
    return fail(r, "Your workspace couldn't be read")?.org_id ?? "";
  }

  async function start(given) {
    const orgId = given || (await workspace());
    if (!orgId) throw new Error("Open the web board once to make your workspace, then pair a phone.");
    const me = await myDevice();
    const row = fail(await db().from("phone_pairings").insert({ org_id: orgId, mac_device: macDevice(), mac_key: me.publicKey }).select("id").single(), "The pairing code couldn't be made");
    const secret = newSecret(sodium());
    const expiresAt = now() + TTL_MS;
    open.set(row.id, { secret, orgId, expiresAt });
    return { id: row.id, link: pairingLink({ id: row.id, secret, orgId, mac: fingerprint(me.publicKey) }), expiresAt };
  }

  async function setStatus(id, patch) {
    fail(await db().from("phone_pairings").update(patch).eq("id", id), "The pairing couldn't be updated");
  }

  async function addDevice(claim) {
    const row = { name: claim.name, public_key: claim.box_key, fingerprint: fingerprint(claim.box_key), platform: claim.platform, kind: claim.kind, sign_key: claim.sign_key };
    const added = await db().from("devices").insert(row).select("id").single();
    if (!added.error) return added.data.id;
    if (added.error.code !== "23505") fail(added, "The device couldn't be added");
    const found = fail(await db().from("devices").select("id, revoked_at").eq("public_key", claim.box_key).single(), "The device couldn't be found");
    if (found.revoked_at) throw new Error("That device was revoked. Remove Weft's keys on it and pair again.");
    return found.id;
  }

  // Where a code stands. A claim found here is checked, confirmed with Touch ID and paired in one go.
  /** @returns {Promise<{ status: "open"|"paired"|"cancelled"|"expired"|"failed", error?: string, device?: object }>} */
  async function check(id) {
    const code = open.get(id);
    if (!code) return { status: "expired" };
    if (now() > code.expiresAt) {
      open.delete(id);
      await setStatus(id, { status: "cancelled" }).catch(() => {});
      return { status: "expired" };
    }
    const row = fail(await db().from("phone_pairings").select("*").eq("id", id).single(), "The pairing couldn't be read");
    if (row.status === "open") return { status: "open" };
    if (row.status !== "claimed") {
      open.delete(id);
      return { status: "cancelled" };
    }
    open.delete(id);
    const why = checkClaim(sodium(), { id, orgId: code.orgId, secret: code.secret }, row);
    if (why) {
      await setStatus(id, { status: "cancelled" });
      return { status: "failed", error: why };
    }
    const label = row.kind === "phone" ? "phone" : "browser";
    if (!(await confirm(`pair the ${label} "${row.name}" (${fingerprint(row.box_key).slice(0, 8)}) with this Mac`))) {
      await setStatus(id, { status: "cancelled" });
      return { status: "cancelled" };
    }
    const deviceId = await addDevice(row);
    const device = { id: deviceId, name: row.name, kind: row.kind, platform: row.platform, signKey: row.sign_key, boxKey: row.box_key, fingerprint: fingerprint(row.box_key), orgId: code.orgId, pairedAt: new Date(now()).toISOString() };
    paired.pin(device);
    await syncKeys.current(code.orgId, { create: true });
    await syncKeys.grantAll(code.orgId, deviceId, row.box_key);
    await setStatus(id, { status: "paired", device_id: deviceId });
    return { status: "paired", device: publicView(device) };
  }

  async function cancel(id) {
    if (!open.delete(id)) return;
    await setStatus(id, { status: "cancelled" }).catch(() => {});
  }

  async function revoke(deviceId) {
    const device = paired.list().find((d) => d.id === deviceId);
    if (!paired.unpin(deviceId) || !device) return { ok: false };
    fail(await db().from("workspace_key_grants").delete().eq("device_id", deviceId), "The device's key couldn't be removed");
    fail(await db().from("devices").update({ revoked_at: new Date(now()).toISOString() }).eq("id", deviceId), "The device couldn't be marked revoked");
    const keep = paired.list().filter((d) => d.orgId === device.orgId).map((d) => ({ id: d.id, boxKey: d.boxKey }));
    const version = await syncKeys.rotate(device.orgId, keep);
    return { ok: true, version };
  }

  const publicView = (d) => ({ id: d.id, name: d.name, kind: d.kind, platform: d.platform, fingerprint: d.fingerprint, pairedAt: d.pairedAt });
  const list = () => paired.list().map(publicView);

  return { start, check, cancel, revoke, list };
}

module.exports = { createPairing, TTL_MS };
