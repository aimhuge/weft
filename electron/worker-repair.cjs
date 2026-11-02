// Approving a worker's re-pair, this Mac's half (docs/architecture/project-hosts.md#re-pairing-a-worker). A paired box
// trusts this Mac's approval key (the one its pairing code carried, electron/desktop-signer.cjs), and swaps it for
// another Mac only on this Mac's signature over `weft-repair-v1`: this worker, the new Mac's key and the new code's
// pairing and workspace. Settings → Devices → Approve re-pair pastes the new code here, main asks Touch ID naming the
// worker and the new Mac's fingerprint, signs, and hands back the `wra.` line the user carries to the box.
// Board window only (electron/host-pairing-ipc.cjs): never the control server a thread can call.
//
// The message, the line and the fingerprint are lib/worker-repair.ts's, here because main can't load TypeScript;
// lib/worker-repair.test.ts proves an approval made here passes the box's check and a changed one doesn't.
const crypto = require("node:crypto");

const PAIR_PREFIX = "wph.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const MAC_KEY = /^[A-Za-z0-9_-]{43}$/;
// The worker's name shows in the Touch ID prompt (lib/host-pairing.ts SAFE_NAME).
const SAFE_NAME = /^[\p{L}\p{N} ._()-]{1,80}$/u;

const repairMessage = (f) => ["weft-repair-v1", f.worker, f.newMacKey, f.pairingId, f.orgId, String(f.issuedAt), f.nonce].join("\n");

function macFingerprint(key) {
  const hex = crypto.createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 16);
  return hex.match(/.{4}/g).join(" ");
}

// lib/host-pairing.ts parsePairCode, for a code that must carry a Mac key.
function parseCode(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed.startsWith(PAIR_PREFIX)) return null;
  const [id = "", orgId = "", secret = "", mac = "", ...rest] = trimmed.slice(PAIR_PREFIX.length).split(".");
  if (rest.length || !UUID.test(id) || !UUID.test(orgId) || !SECRET.test(secret) || !MAC_KEY.test(mac)) return null;
  return { id, orgId, code: trimmed, macKey: Buffer.from(mac, "base64url").toString("base64") };
}

/**
 * @param {{ confirm: (reason: string) => Promise<boolean>, sign: (message: string) => Promise<string>,
 *   publicKey: () => Promise<string>, worker: (id: string) => Promise<{ name: string } | null>,
 *   openedHere: (pairingId: string) => boolean, now?: () => number, nonce?: () => string }} deps
 * sign and publicKey are this Mac's approval key (electron/desktop-signer.cjs), base64. worker reads the worker from
 * main's own session (one of yours, or null), so the prompt names the worker the signature is for, never the
 * renderer's word for it. openedHere says whether this Mac made that pairing code (electron/host-pairing.cjs).
 */
function createWorkerRepair({ confirm, sign, publicKey, worker: readWorker, openedHere, now = Date.now, nonce = () => crypto.randomBytes(16).toString("hex") }) {
  /**
   * @param {string} worker the worker's id (its Devices row)
   * @param {string} codeText the new wph.… code, from the Mac the box will trust next
   * @returns {Promise<{ denied: true } | { approval: string, command: string, fingerprint: string }>}
   */
  async function approve(worker, codeText) {
    const row = UUID.test(String(worker)) ? await readWorker(String(worker)) : null;
    if (!row) throw new Error("That isn't a worker of yours.");
    const label = SAFE_NAME.test(String(row.name)) ? String(row.name) : "this worker";
    const code = parseCode(codeText);
    if (!code) throw new Error("Paste the whole wph.… line the new Mac shows under Settings → Devices → Add a worker.");
    const fingerprint = macFingerprint(code.macKey);
    const same = code.macKey === (await publicKey());
    // This Mac's key is public, so anyone can put it in a code of their own workspace: a code naming this Mac must be
    // one this Mac opened, or the box would follow it into someone else's workspace.
    if (same && !openedHere(code.id)) throw new Error("That code names this Mac but wasn't made on it. Make it here with Add a worker, then paste it.");
    // The fingerprint first, so a long name can't push it out of the prompt.
    const reason = same
      ? `let the worker ${label} pair again with this Mac (${fingerprint}), with the code this Mac just made`
      : `let the worker ${label} stop trusting this Mac and trust the Mac ${fingerprint} instead, with its secrets and settings`;
    if (!(await confirm(reason))) return { denied: true };
    const issuedAt = now();
    const n = nonce();
    const sig = await sign(repairMessage({ worker: String(worker), newMacKey: code.macKey, pairingId: code.id, orgId: code.orgId, issuedAt, nonce: n }));
    const approval = `wra.${issuedAt}.${n}.${Buffer.from(sig, "base64").toString("base64url")}`;
    return { approval, command: `weft-worker enrol ${code.code} --re-pair --approval ${approval}`, fingerprint };
  }

  return { approve };
}

module.exports = { createWorkerRepair, repairMessage, macFingerprint };
