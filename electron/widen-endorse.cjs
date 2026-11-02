// The endorsements that let this Mac's paired passkeys widen on a worker (docs/architecture/project-hosts.md#signed-widening-as-built):
// main signs `weft-endorse-v2` with this Mac's approval key over the whole set of passkeys a worker may trust, with a
// generation that only grows, and the worker (lib/host-signers.ts) replaces its list with the newest set it's sent. So
// a revoke is just a smaller set, and an older endorsement read off an earlier `pin` row can't bring a passkey back.
//
// Main keeps which passkeys it endorsed for which worker (vault/endorsed-workers.json, sealed with safeStorage), so
// unpairing a passkey (pairing:revoke) re-sends every worker the set without it: a narrowing, signed without Touch ID.
// It keeps re-sending until the worker's receipt, signed with the worker's pinned sign key, says it holds that
// generation: a row a stolen session deletes, or one a stolen worker key claims and drops, isn't a revoke that landed.
// Widening a worker's set (Passkeys in Settings → Devices) asks Touch ID. Board window only, as electron/widen-sign.cjs.
const crypto = require("node:crypto");
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

const HELD_V = "weft-endorse-held-v1";
const heldMessage = (h) => canonical({ v: HELD_V, worker: h.worker, generation: h.generation });
const keyOf = (k) => `${k.device} ${k.credId} ${k.publicKey}`;

/** Whether a worker's receipt is signed by the sign key this Mac pinned for it (lib/host-endorse.ts heldMessage). */
function heldSigned(signKey, worker, receipt) {
  if (!signKey || !receipt || typeof receipt !== "object" || !Number.isFinite(receipt.generation) || typeof receipt.sig !== "string") return false;
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(signKey, "base64"), format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(heldMessage({ worker, generation: receipt.generation })), key, Buffer.from(receipt.sig, "base64"));
  } catch {
    return false;
  }
}

/**
 * @param {(channel: string, fn: (...args: any[]) => unknown) => void} handle the board-only IPC handler
 * @param {{ signer: { sign: (m: string) => string }, macDevice: () => string, confirm: (reason: string) => Promise<boolean>,
 *   passkeys: () => Array<{ id: string, passkey?: { credId: string, publicKey: string } }>,
 *   endorsed: ReturnType<typeof createEndorsed>, workerName?: (id: string) => string | null,
 *   workerSignKey?: (id: string) => string | null, now?: () => number }} deps
 */
function registerWidenEndorse(handle, { signer, macDevice, confirm, passkeys, endorsed, workerName = () => null, workerSignKey = () => null, now = Date.now }) {
  // The passkeys this Mac has pinned now, each by its device, credential and key.
  const pairedKeys = () => passkeys().filter((d) => d.passkey).map((d) => ({ device: d.id, credId: d.passkey.credId, publicKey: d.passkey.publicKey }));

  // One worker's whole set, signed with the next generation, and remembered (with the endorsement itself) until the
  // worker's receipt says it holds it.
  function sign(worker, keys, before) {
    const generation = Math.max(now(), (Number(before?.generation) || 0) + 1);
    const e = { worker, passkeys: keys, generation, issuedAt: now() };
    const endorsement = { ...e, mac: macDevice(), sig: signer.sign(endorseMessage(e)) };
    endorsed.set(worker, { keys, generation, endorsement, confirmed: Number(before?.confirmed) || 0 });
    return endorsement;
  }

  const named = (worker) => {
    const name = workerName(worker);
    return name ? `${name} (${worker.slice(0, 8)})` : worker;
  };

  // Every passkey this Mac pinned, for one worker, after Touch ID: [] when there are none, null when refused. With
  // `revoke`, none: a narrowing, so no Touch ID.
  handle("approval:endorse", async (raw) => {
    const worker = raw && typeof raw === "object" ? raw.worker : undefined;
    if (typeof worker !== "string" || !ID.test(worker)) throw new Error("That names no worker.");
    const before = endorsed.read()[worker];
    if (raw.revoke === true) return [sign(worker, [], before)];
    const keys = pairedKeys();
    if (!keys.length) return [];
    if (!(await confirm(`let your ${keys.length === 1 ? "paired passkey" : `${keys.length} paired passkeys`} approve folder, agent and "!" changes on the worker ${named(worker)}`))) return null;
    return [sign(worker, keys, before)];
  });

  // Every worker whose set the worker hasn't confirmed yet, after narrowing each to the passkeys still paired here, the
  // exact same credential and key (a device id paired again with a new passkey isn't in it: adding one asks Touch ID).
  // A narrowing is signed without Touch ID; one already signed and not yet confirmed is sent again as it was.
  handle("approval:endorse-refresh", () => {
    const paired = new Set(pairedKeys().map(keyOf));
    const out = [];
    for (const [worker, record] of Object.entries(endorsed.read())) {
      if (!ID.test(worker) || !record || typeof record !== "object") continue;
      const was = Array.isArray(record.keys) ? record.keys : [];
      const keep = was.filter((k) => paired.has(keyOf(k)));
      const endorsement = keep.length !== was.length || !record.endorsement ? sign(worker, keep, record) : record.endorsement;
      const generation = Number(endorsement.generation);
      if ((Number(record.confirmed) || 0) < generation) out.push({ worker, generation, endorsements: [endorsement] });
    }
    return out;
  });

  // A worker's receipt for a pin: signed by its pinned sign key, it says the worker holds that generation, and the Mac
  // stops re-sending.
  handle("approval:endorse-confirm", async (raw) => {
    const worker = raw && typeof raw === "object" ? raw.worker : undefined;
    if (typeof worker !== "string" || !ID.test(worker)) throw new Error("That names no worker.");
    const record = endorsed.read()[worker];
    if (!record || !heldSigned(workerSignKey(worker), worker, raw.receipt)) return false;
    endorsed.set(worker, { ...record, confirmed: Math.max(Number(record.confirmed) || 0, raw.receipt.generation) });
    return raw.receipt.generation >= Number(record.generation);
  });
}

module.exports = { registerWidenEndorse, createEndorsed, endorseMessage, heldMessage, ENDORSE_V };
