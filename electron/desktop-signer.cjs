// This Mac's own approval key (docs/architecture/mobile-security.md, "The desktop signs too"): an Ed25519 key that only
// Electron main holds, so an Allow given on the desktop board is the same signed approval a phone sends, over the same
// message (lib/approval-sig.ts), checked on the same path (POST /pairing/verify, electron/paired-devices.cjs verify).
// The key sits sealed with safeStorage in ~/.weft/vault/, which threads can't read (lib/secret-guard-files.ts); main
// signs only after Touch ID, for the board window only (electron/pairing-ipc.cjs `approval:sign`), never for the
// control server a thread can call.
const fs = require("node:fs");
const path = require("node:path");

const ORIGINAL = 1; // sodium.base64_variants.ORIGINAL, as lib/sodium.ts b64

// Main's copy of lib/approval-sig.ts approvalMessage; electron/desktop-signer.test.ts proves the two agree.
const canonicalAnswers = (answers) => JSON.stringify(Object.fromEntries(Object.keys(answers).sort().map((k) => [k, answers[k]])));
function answersHash(sodium, answers) {
  if (!answers || !Object.keys(answers).length) return "-";
  return sodium.to_hex(sodium.crypto_generichash(32, sodium.from_string(canonicalAnswers(answers))));
}
function approvalMessage(sodium, f) {
  return ["weft-approval-v1", f.orgId, f.macDevice, f.cardId, f.pendingId, f.allow ? "allow" : "deny", String(f.issuedAt), answersHash(sodium, f.answers), ...(f.grant ? [`grant:${f.grant}`] : [])].join("\n");
}

/**
 * @param {{ dir: string, safeStorage: () => { encryptString: (s: string) => Buffer, decryptString: (b: Buffer) => string }, sodium: () => any }} deps
 */
function createDesktopSigner({ dir, safeStorage, sodium }) {
  const file = path.join(dir, "vault", "desktop-sign-key.json");
  /** @type {{ publicKey: string, privateKey: string } | null} */
  let key = null;

  // The key, made the first time. A file that won't open is never replaced: a new key would orphan every host that
  // pinned the old one, so signing fails until the user removes it.
  function load() {
    if (key) return key;
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(safeStorage().decryptString(Buffer.from(fs.readFileSync(file, "utf8"), "base64")));
      if (typeof parsed.publicKey !== "string" || typeof parsed.privateKey !== "string") throw new Error("This Mac's approval key is unreadable.");
      key = parsed;
      return key;
    }
    const s = sodium();
    const pair = s.crypto_sign_keypair();
    key = { publicKey: s.to_base64(pair.publicKey, ORIGINAL), privateKey: s.to_base64(pair.privateKey, ORIGINAL) };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, safeStorage().encryptString(JSON.stringify(key)).toString("base64"), { mode: 0o600 });
    return key;
  }

  /** @returns {string} */
  const publicKey = () => load().publicKey;

  /** @param {string} message @returns {string} */
  function sign(message) {
    const s = sodium();
    return s.to_base64(s.crypto_sign_detached(s.from_string(message), s.from_base64(load().privateKey, ORIGINAL)), ORIGINAL);
  }

  /** Whether `sig` over `message` is this Mac's. @returns {boolean} */
  function verify(message, sig) {
    if (!fs.existsSync(file) && !key) return false;
    const s = sodium();
    try {
      return s.crypto_sign_verify_detached(s.from_base64(String(sig), ORIGINAL), s.from_string(String(message)), s.from_base64(publicKey(), ORIGINAL));
    } catch {
      return false;
    }
  }

  // Opens what a paired Weft Worker sealed to this Mac's key (lib/mac-box.ts, a thread's set_value): libsodium's sealed
  // box to the X25519 twin of this Ed25519 key. Throws when it wasn't sealed to this Mac. The key never leaves main.
  /** @param {string} sealed base64 @returns {string} */
  function openBox(sealed) {
    const s = sodium();
    const { publicKey: pk, privateKey: sk } = load();
    const curvePk = s.crypto_sign_ed25519_pk_to_curve25519(s.from_base64(pk, ORIGINAL));
    const curveSk = s.crypto_sign_ed25519_sk_to_curve25519(s.from_base64(sk, ORIGINAL));
    return s.to_string(s.crypto_box_seal_open(s.from_base64(String(sealed), ORIGINAL), curvePk, curveSk));
  }

  return { publicKey, sign, verify, openBox, file };
}

module.exports = { createDesktopSigner, approvalMessage };
