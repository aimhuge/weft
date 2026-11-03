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

// The head: this Mac's latest generation for a worker, signed and put in the insert-only worker_passkey_heads log, which
// the worker reads before a passkey approval counts (lib/passkey-head.ts headMessage, the same bytes). A revoke whose pin
// row a stolen session deletes still reaches the worker this way: the log has no delete for clients. Signed again daily,
// so the log (pruned after 30 days) always holds one.
const HEAD_V = "weft-endorse-head-v1";
const headMessage = (h) => canonical({ v: HEAD_V, worker: h.worker, generation: h.generation, issuedAt: h.issuedAt });
const HEAD_EVERY_MS = 24 * 3_600_000;
const HEAD_RETRY_MS = 5 * 60_000;

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
 *   workerSignKey?: (id: string) => string | null, now?: () => number,
 *   publishHead?: (worker: string, head: object) => Promise<unknown>, reconcile?: () => Promise<unknown> }} deps
 * publishHead inserts a signed head in worker_passkey_heads; reconcile drops passkeys and phones revoked from another
 * Mac (electron/pairing.cjs reconcile) before a refresh narrows each worker's set.
 */
function registerWidenEndorse(handle, { signer, macDevice, confirm, passkeys, endorsed, workerName = () => null, workerSignKey = () => null, now = Date.now, publishHead, reconcile }) {
  // The passkeys this Mac has pinned now, each by its device, credential and key.
  const pairedKeys = () => passkeys().filter((d) => d.passkey).map((d) => ({ device: d.id, credId: d.passkey.credId, publicKey: d.passkey.publicKey }));

  // One worker's whole set, signed with the next generation, and remembered (with the endorsement itself) until the
  // worker's receipt says it holds it.
  function sign(worker, keys, before) {
    const generation = Math.max(now(), (Number(before?.generation) || 0) + 1);
    const e = { worker, passkeys: keys, generation, issuedAt: now() };
    const endorsement = { ...e, mac: macDevice(), sig: signer.sign(endorseMessage(e)) };
    endorsed.set(worker, { keys, generation, endorsement, confirmed: Number(before?.confirmed) || 0, headGeneration: Number(before?.headGeneration) || 0, headAt: Number(before?.headAt) || 0 });
    return endorsement;
  }

  // Signs and publishes the head for a worker's current generation; remembered once it's in, so a failed insert is tried
  // again on the next refresh. Never throws: the pin still goes out.
  async function publish(worker) {
    const record = endorsed.read()[worker];
    if (!publishHead || !record || !Number.isFinite(Number(record.generation))) return false;
    const head = { worker, generation: Number(record.generation), issuedAt: now() };
    try {
      await publishHead(worker, { ...head, mac: macDevice(), sig: signer.sign(headMessage(head)) });
    } catch {
      // A worker deleted since, or the log not there yet: asked again in a few minutes, or at once for a newer set.
      endorsed.set(worker, { ...endorsed.read()[worker], headTried: head.generation, headTriedAt: head.issuedAt });
      return false;
    }
    endorsed.set(worker, { ...endorsed.read()[worker], headGeneration: head.generation, headAt: head.issuedAt });
    return true;
  }

  // Every worker whose head is behind its set, or a day old.
  async function publishDue() {
    for (const [worker, record] of Object.entries(endorsed.read())) {
      if (!ID.test(worker) || !record || typeof record !== "object") continue;
      const stale = (Number(record.headGeneration) || 0) < Number(record.generation) || now() - (Number(record.headAt) || 0) >= HEAD_EVERY_MS;
      const failedLately = record.headTried === record.generation && now() - (Number(record.headTriedAt) || 0) < HEAD_RETRY_MS;
      if (stale && !failedLately) await publish(worker);
    }
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
    if (raw.revoke === true) {
      const endorsement = sign(worker, [], before);
      await publish(worker);
      return [endorsement];
    }
    const keys = pairedKeys();
    if (!keys.length) return [];
    if (!(await confirm(`let your ${keys.length === 1 ? "paired passkey" : `${keys.length} paired passkeys`} approve folder, agent and "!" changes on the worker ${named(worker)}`))) return null;
    const endorsement = sign(worker, keys, before);
    await publish(worker);
    return [endorsement];
  });

  // Every worker whose set the worker hasn't confirmed yet, after narrowing each to the passkeys still paired here, the
  // exact same credential and key (a device id paired again with a new passkey isn't in it: adding one asks Touch ID).
  // A narrowing is signed without Touch ID; one already signed and not yet confirmed is sent again as it was.
  handle("approval:endorse-refresh", async () => {
    if (reconcile) await reconcile().catch(() => {});
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
    await publishDue();
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

module.exports = { registerWidenEndorse, createEndorsed, endorseMessage, heldMessage, headMessage, ENDORSE_V, HEAD_V, HEAD_EVERY_MS };
