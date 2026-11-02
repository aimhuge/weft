// The endorsements that let this Mac's paired passkeys widen on a worker (docs/architecture/project-hosts.md#signed-widening-as-built):
// main signs `weft-endorse-v2` with this Mac's approval key over the whole set of passkeys a worker may trust, with a
// generation that only grows, and the worker (lib/host-signers.ts) replaces its list with the newest set it's sent. So
// a revoke is just a smaller set, and an older endorsement read off an earlier `pin` row can't bring a passkey back.
//
// Main keeps which passkeys it endorsed for which worker (vault/endorsed-workers.json, sealed with safeStorage), so
// unpairing a passkey (pairing:revoke) re-sends every worker the set without it: a narrowing, signed without Touch ID.
// Widening a worker's set (Passkeys in Settings → Devices) asks Touch ID. Board window only, as electron/widen-sign.cjs.
const fs = require("node:fs");
const path = require("node:path");
const { canonical } = require("./widen-sign.cjs");

const ENDORSE_V = "weft-endorse-v2";
const ID = /^[A-Za-z0-9_:.-]{1,200}$/;

const byKey = (a, b) => (a.device + a.credId < b.device + b.credId ? -1 : a.device + a.credId > b.device + b.credId ? 1 : 0);
const endorseMessage = (e) =>
  canonical({ v: ENDORSE_V, worker: e.worker, passkeys: [...e.passkeys].sort(byKey).map((p) => ({ device: p.device, credId: p.credId, publicKey: p.publicKey })), generation: e.generation, issuedAt: e.issuedAt });

/** Which passkeys this Mac endorsed for each worker, and the last generation. A copy that won't open endorses nothing. */
function createEndorsed({ dir, safeStorage }) {
  const file = path.join(dir, "vault", "endorsed-workers.json");
  function read() {
    try {
      const parsed = JSON.parse(safeStorage().decryptString(Buffer.from(fs.readFileSync(file, "utf8"), "base64")));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  function set(worker, record) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const all = { ...read(), [worker]: record };
    fs.writeFileSync(file, safeStorage().encryptString(JSON.stringify(all)).toString("base64"), { mode: 0o600 });
  }
  return { read, set, file };
}

/**
 * @param {(channel: string, fn: (...args: any[]) => unknown) => void} handle the board-only IPC handler
 * @param {{ signer: { sign: (m: string) => string }, macDevice: () => string, confirm: (reason: string) => Promise<boolean>,
 *   passkeys: () => Array<{ id: string, passkey?: { credId: string, publicKey: string } }>,
 *   endorsed: ReturnType<typeof createEndorsed>, now?: () => number }} deps
 */
function registerWidenEndorse(handle, { signer, macDevice, confirm, passkeys, endorsed, now = Date.now }) {
  const paired = () => passkeys().filter((d) => d.passkey);

  // One worker's whole set, signed with the next generation, and remembered for a later narrowing.
  function sign(worker, devices) {
    const before = endorsed.read()[worker];
    const generation = Math.max(now(), (Number(before?.generation) || 0) + 1);
    const keys = paired().filter((d) => devices.includes(d.id));
    endorsed.set(worker, { devices: keys.map((d) => d.id), generation });
    const e = { worker, passkeys: keys.map((d) => ({ device: d.id, credId: d.passkey.credId, publicKey: d.passkey.publicKey })), generation, issuedAt: now() };
    return { ...e, mac: macDevice(), sig: signer.sign(endorseMessage(e)) };
  }

  // Every passkey this Mac pinned, for one worker, after Touch ID: [] when there are none, null when refused. With
  // `revoke`, none: a narrowing, so no Touch ID.
  handle("approval:endorse", async (raw) => {
    const worker = raw && typeof raw === "object" ? raw.worker : undefined;
    if (typeof worker !== "string" || !ID.test(worker)) throw new Error("That names no worker.");
    if (raw.revoke === true) return [sign(worker, [])];
    const keys = paired();
    if (!keys.length) return [];
    if (!(await confirm(`let your ${keys.length === 1 ? "paired passkey" : `${keys.length} paired passkeys`} approve folder, agent and "!" changes on the worker ${worker.slice(0, 8)}`))) return null;
    return [sign(worker, keys.map((d) => d.id))];
  });

  // After a passkey is unpaired: each worker's set without it, so the worker stops trusting it too.
  handle("approval:endorse-refresh", () =>
    Object.entries(endorsed.read())
      .filter(([worker]) => ID.test(worker))
      .map(([worker, record]) => ({ worker, endorsements: [sign(worker, Array.isArray(record?.devices) ? record.devices : [])] })),
  );
}

module.exports = { registerWidenEndorse, createEndorsed, endorseMessage, ENDORSE_V };
