// Enrolling a Weft Worker by pairing it, this Mac's half (docs/architecture/device-registry.md). The same steps as
// pairing a phone (electron/pairing.cjs): main makes the code and keeps its secret in memory only, the box claims it
// with its keys, a proof made with the secret and a signature, main checks both, asks Touch ID naming the check code
// the box printed, then confirms, which makes the worker's cloud_workers row with the keys main checked. Started over
// IPC from the board only (electron/host-pairing-ipc.cjs): a thread that could pair would add its own worker.
//
// The claim check is lib/host-pairing.ts's, here because main can't load TypeScript; lib/host-pairing.test.ts proves
// a claim the box makes passes this check and a changed one doesn't.
const crypto = require("node:crypto");
const { macFingerprint } = require("./worker-repair.cjs");

// An hour, like an enrolment token and the row's own expires_at (worker_pair_open): the box clones and installs first.
const TTL_MS = 60 * 60_000;
const PREFIX = "wph.";
const PLATFORMS = ["darwin", "linux", "win32"];
const PLAIN_LINE = /^[^\p{Cc}]+$/u;
// The name shows in the Touch ID prompt: letters, digits, spaces and . _ ( ) - only (lib/host-pairing.ts SAFE_NAME).
const SAFE_NAME = /^[\p{L}\p{N} ._()-]{1,80}$/u;

const claimMessage = (pairingId, orgId, c) =>
  ["weft-host-pair-v1", pairingId, orgId, c.box_key, c.sign_key, c.key_hash, c.name, c.platform, c.arch].join("\n");

function checkCode(pairingId, orgId, c) {
  const hex = crypto.createHash("sha256").update(claimMessage(pairingId, orgId, c)).digest("hex").slice(0, 8).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

// What's wrong with a claim's fields before any crypto, or null.
function fieldProblem(row) {
  const { kind, name, platform, box_key, sign_key, key_hash, proof, sig } = row;
  const arch = row.arch ?? "";
  if (kind !== "worker") return "The claim isn't a worker's.";
  if (!name || !platform || !box_key || !sign_key || !key_hash || !proof || !sig) return "The claim is missing a field.";
  if (!PLATFORMS.includes(String(platform)) || !/^[0-9a-f]{64}$/.test(String(key_hash))) return "The claim names an unknown kind of worker.";
  if (!SAFE_NAME.test(String(name))) return "The claim's name has characters a worker's name can't.";
  if (arch !== "" && !PLAIN_LINE.test(String(arch))) return "The claim's arch isn't one line.";
  return null;
}

/**
 * Why a worker's claim can't be trusted, or null when it can.
 * @param {{ id: string, orgId: string, secret: string }} code
 * @param {Record<string, unknown>} row the phone_pairings row
 * @returns {string | null}
 */
function checkHostClaim(code, row) {
  const problem = fieldProblem(row);
  if (problem) return problem;
  const { name, platform, box_key, sign_key, key_hash, proof, sig } = row;
  const message = Buffer.from(claimMessage(code.id, code.orgId, { name, platform, arch: row.arch ?? "", box_key, sign_key, key_hash }));
  try {
    const expected = crypto.createHmac("sha512", Buffer.from(code.secret, "base64url")).update(message).digest().subarray(0, 32);
    const given = Buffer.from(String(proof), "base64");
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return "The claim wasn't made with this code.";
    const key = crypto.createPublicKey({ key: Buffer.from(String(sign_key), "base64"), format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519" || !crypto.verify(null, message, key, Buffer.from(String(sig), "base64")))
      return "The claim's signature doesn't match its key.";
  } catch {
    return "The claim isn't readable.";
  }
  return null;
}

// The defaults pairing plans (pairingDefaults in electron/pairing-ipc.cjs): each { key, say, run }, read before the prompt.
async function planned(pairingDefaults) {
  const plans = await Promise.resolve().then(pairingDefaults).catch(() => []);
  return Array.isArray(plans) ? plans.filter((p) => p && typeof p.key === "string" && typeof p.say === "string" && typeof p.run === "function") : [];
}

// ", let your paired passkey approve … there, and let its cards use GitHub …": the plans' clauses after the prompt's own.
function alsoSaid(plans) {
  const says = plans.map((p) => p.say);
  if (!says.length) return "";
  return `, ${says.length > 1 ? `${says.slice(0, -1).join(", ")}, and ${says[says.length - 1]}` : says[0]}`;
}

// Each default done for the new worker, one at a time; one that fails says why and doesn't undo the pairing or the others.
async function applied(plans, workerId) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const p of plans) out[p.key] = await Promise.resolve().then(() => p.run(workerId)).then((r) => r ?? { ok: true }, (err) => ({ error: String(err?.message ?? err) }));
  return out;
}

/**
 * @param {{ db: () => any, userId: () => string, macDevice: () => string, myDevice: () => Promise<{ publicKey: string }>,
 *   confirm: (reason: string) => Promise<boolean>, now?: () => number,
 *   pinWorker?: (id: string, keys: { name: string, publicKey: string, signKey: string }) => void,
 *   macSignKey?: () => Promise<string>, vouchWorker?: (id: string) => Promise<unknown>,
 *   pairingDefaults?: () => Promise<Array<{ key: string, say: string, run: (workerId: string) => Promise<unknown> }>> }} deps
 * macSignKey is this Mac's Ed25519 approval key (electron/desktop-signer.cjs, base64): it rides in the code, which the
 * user carries to the box by hand, so the box trusts the secret_use rows this Mac signs and no one else's
 * (lib/worker-mac-keys.ts). Never through the database, where any session of yours could swap it.
 * pinWorker pins the keys main just checked (electron/worker-pins.cjs), under the same Touch ID, so the worker's secret
 * asks must carry its sign key's signature (electron/worker-secret.cjs) and its box key can't be swapped later.
 * vouchWorker signs those pinned keys for weft.zip (electron/connector-grants.cjs), so its connector mint serves the
 * worker only with the sign key this Mac checked.
 * pairingDefaults plans what a new worker gets by default (passkeys, GitHub): each clause goes in the one Touch ID prompt,
 * and each runs only after its yes, its outcome in the result's `defaults`.
 */
function createHostPairing({ db, userId, macDevice, myDevice, confirm, now = Date.now, pinWorker = () => {}, macSignKey = undefined, vouchWorker = async () => {}, pairingDefaults = async () => [] }) {
  /** @type {Map<string, { secret: string, orgId: string, expiresAt: number }>} */
  const open = new Map();

  const fail = (r, what) => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    return r.data;
  };

  // The workspace synced cards and workers go to: the user's first owned org (lib/cloud-sync.ts resolveOrgId).
  async function workspace() {
    const r = await db().from("org_memberships").select("org_id").eq("user_id", userId()).eq("role", "owner").order("created_at", { ascending: true }).limit(1).maybeSingle();
    return fail(r, "Your workspace couldn't be read")?.org_id ?? "";
  }

  /** @returns {Promise<{ id: string, code: string, command: string, expiresAt: number, fingerprint?: string }>} */
  async function start(given) {
    const orgId = given || (await workspace());
    if (!orgId) throw new Error("Open the web board once to make your workspace, then add a worker.");
    const me = await myDevice();
    const id = /** @type {string} */ (fail(await db().rpc("worker_pair_open", { p_org: orgId, p_mac_device: macDevice(), p_mac_key: me.publicKey }), "The pairing code couldn't be made"));
    const secret = crypto.randomBytes(32).toString("base64url");
    const expiresAt = now() + TTL_MS;
    open.set(id, { secret, orgId, expiresAt });
    const mac = macSignKey ? `.${Buffer.from(await macSignKey(), "base64").toString("base64url")}` : "";
    const code = `${PREFIX}${id}.${orgId}.${secret}${mac}`;
    // This Mac's key's fingerprint, the one a re-pair's Touch ID prompt on the box's old Mac shows (electron/worker-repair.cjs).
    const fingerprint = macSignKey ? macFingerprint(await macSignKey()) : undefined;
    return { id, code, command: `curl -fsSL https://weft.zip/worker.sh | sh -s -- ${code}`, expiresAt, ...(fingerprint ? { fingerprint } : {}) };
  }

  async function setStatus(id, status) {
    fail(await db().from("phone_pairings").update({ status }).eq("id", id), "The pairing couldn't be updated");
  }

  /** @returns {Promise<{ status: "open"|"paired"|"cancelled"|"expired"|"failed", error?: string, worker?: { id: string, name: string, platform: string, code: string } }>} */
  async function check(id) {
    const code = open.get(id);
    if (!code) return { status: "expired" };
    if (now() > code.expiresAt) {
      open.delete(id);
      await setStatus(id, "cancelled").catch(() => {});
      return { status: "expired" };
    }
    const row = fail(await db().from("phone_pairings").select("*").eq("id", id).single(), "The pairing couldn't be read");
    if (row.status === "open") return { status: "open" };
    open.delete(id);
    if (row.status !== "claimed" || row.purpose !== "worker") return { status: "cancelled" };
    const why = checkHostClaim({ id, orgId: code.orgId, secret: code.secret }, row);
    if (why) {
      await setStatus(id, "cancelled");
      return { status: "failed", error: why };
    }
    const shown = checkCode(id, code.orgId, { ...row, arch: row.arch ?? "" });
    // What a new worker gets by default (docs/architecture/weft-worker.md#defaults-at-pairing), each said in this one
    // prompt and done only after its yes: your passkeys and phones approving there, GitHub for its cards. A default that
    // can't be planned is left out, never a reason not to pair.
    const plans = await planned(pairingDefaults);
    // The code first, so a long name can't push it out of the prompt; the name is SAFE_NAME-checked above.
    if (!(await confirm(`check the box shows the code ${shown}, then add the worker ${row.name} to your workspace${alsoSaid(plans)}`))) {
      await setStatus(id, "cancelled");
      return { status: "cancelled" };
    }
    const workerId = fail(
      await db().rpc("worker_pair_confirm", { p_pairing: id, p_key_hash: row.key_hash, p_box_key: row.box_key, p_sign_key: row.sign_key }),
      "The worker couldn't be added",
    );
    try {
      pinWorker(String(workerId), { name: String(row.name), publicKey: String(row.box_key), signKey: String(row.sign_key) });
    } catch (err) {
      // An unpinned worker would be pinned later from the row, which anyone with its key can change: take it back.
      await Promise.resolve(db().rpc("device_revoke", { p_id: workerId })).catch(() => {});
      return { status: "failed", error: `The worker's keys couldn't be pinned on this Mac, so it wasn't added: ${err.message}` };
    }
    // Vouch for it on weft.zip, so its connectors can work: best effort, since turning a connector on vouches again.
    await Promise.resolve()
      .then(() => vouchWorker(String(workerId)))
      .catch((err) => console.warn(`Couldn't vouch for the worker on weft.zip: ${err?.message ?? err}`));
    const defaults = await applied(plans, String(workerId));
    return { status: "paired", worker: { id: workerId, name: row.name, platform: row.platform, code: shown }, ...(plans.length ? { defaults } : {}) };
  }

  /** @returns {Promise<void>} */
  async function cancel(id) {
    if (!open.delete(id)) return;
    await setStatus(id, "cancelled").catch(() => {});
  }

  // Whether this Mac opened that code and it's still open (electron/worker-repair.cjs: a re-pair to this Mac).
  const opened = (id) => {
    const code = open.get(String(id));
    return Boolean(code && now() <= code.expiresAt);
  };

  return { start, check, cancel, opened };
}

module.exports = { createHostPairing, checkHostClaim, checkCode, claimMessage, TTL_MS };
