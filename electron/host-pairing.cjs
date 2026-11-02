// Enrolling a Weft Worker by pairing it, this Mac's half (docs/architecture/device-registry.md). The same steps as
// pairing a phone (electron/pairing.cjs): main makes the code and keeps its secret in memory only, the box claims it
// with its keys, a proof made with the secret and a signature, main checks both, asks Touch ID naming the check code
// the box printed, then confirms, which makes the worker's cloud_workers row with the keys main checked. Started over
// IPC from the board only (electron/host-pairing-ipc.cjs): a thread that could pair would add its own worker.
//
// The claim check is lib/host-pairing.ts's, here because main can't load TypeScript; lib/host-pairing.test.ts proves
// a claim the box makes passes this check and a changed one doesn't.
const crypto = require("node:crypto");

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

/**
 * @param {{ db: () => any, userId: () => string, macDevice: () => string, myDevice: () => Promise<{ publicKey: string }>,
 *   confirm: (reason: string) => Promise<boolean>, now?: () => number }} deps
 */
function createHostPairing({ db, userId, macDevice, myDevice, confirm, now = Date.now }) {
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

  /** @returns {Promise<{ id: string, code: string, command: string, expiresAt: number }>} */
  async function start(given) {
    const orgId = given || (await workspace());
    if (!orgId) throw new Error("Open the web board once to make your workspace, then add a worker.");
    const me = await myDevice();
    const id = /** @type {string} */ (fail(await db().rpc("worker_pair_open", { p_org: orgId, p_mac_device: macDevice(), p_mac_key: me.publicKey }), "The pairing code couldn't be made"));
    const secret = crypto.randomBytes(32).toString("base64url");
    const expiresAt = now() + TTL_MS;
    open.set(id, { secret, orgId, expiresAt });
    const code = `${PREFIX}${id}.${orgId}.${secret}`;
    return { id, code, command: `curl -fsSL https://weft.zip/worker.sh | sh -s -- ${code}`, expiresAt };
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
    // The code first, so a long name can't push it out of the prompt; the name is SAFE_NAME-checked above.
    if (!(await confirm(`check the box shows the code ${shown}, then add the worker ${row.name} to your workspace`))) {
      await setStatus(id, "cancelled");
      return { status: "cancelled" };
    }
    const workerId = fail(
      await db().rpc("worker_pair_confirm", { p_pairing: id, p_key_hash: row.key_hash, p_box_key: row.box_key, p_sign_key: row.sign_key }),
      "The worker couldn't be added",
    );
    return { status: "paired", worker: { id: workerId, name: row.name, platform: row.platform, code: shown } };
  }

  /** @returns {Promise<void>} */
  async function cancel(id) {
    if (!open.delete(id)) return;
    await setStatus(id, "cancelled").catch(() => {});
  }

  return { start, check, cancel };
}

module.exports = { createHostPairing, checkHostClaim, checkCode, claimMessage, TTL_MS };
