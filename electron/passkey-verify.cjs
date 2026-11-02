// Main's copy of lib/passkey-verify.ts verifyPasskeyAssertion (docs/architecture/mobile-security.md, "Passkey
// approvals"): main checks a browser's passkey assertion against the key it pinned, and keeps the counter in the same
// step, so nothing outside main can move a counter or skip the check. Same rules, same order, same reasons as the
// TypeScript; electron/passkey-verify.test.ts runs both over the same vectors.
const crypto = require("node:crypto");

// sign.weft.zip only (lib/sign-origin.ts): no weft.zip fallback.
const PASSKEY_RP_ID = "sign.weft.zip";
const PASSKEY_ORIGIN = "https://sign.weft.zip";
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;

/** sign.weft.zip, plus one dev origin when given (main passes it only when not packaged). */
function passkeyOrigins(devOrigin) {
  const origins = [{ origin: PASSKEY_ORIGIN, rpId: PASSKEY_RP_ID }];
  if (!devOrigin) return origins;
  try {
    const url = new URL(devOrigin);
    return [...origins, { origin: url.origin, rpId: url.hostname }];
  } catch {
    return origins;
  }
}

// Strict as lib/passkey-verify.ts fromB64url: canonical only (Node's own decoder would drop stray bits silently).
function fromB64url(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new Error("not base64url");
  const bytes = Buffer.from(text, "base64url");
  if (bytes.toString("base64url") !== text) throw new Error("not canonical base64url");
  return bytes;
}

const sha256 = (data) => crypto.createHash("sha256").update(data).digest();
const challengeFor = (message) => sha256(Buffer.from(String(message), "utf8")).toString("base64url");

function derInt(der, at) {
  if (der[at] !== 0x02) return null;
  const len = der[at + 1] ?? 0;
  let bytes = der.subarray(at + 2, at + 2 + len);
  if (len === 0 || bytes.length !== len) return null;
  while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1);
  if (bytes.length > 32) return null;
  const value = Buffer.alloc(32);
  bytes.copy(value, 32 - bytes.length);
  return { value, next: at + 2 + len };
}

function derToRaw(der) {
  if (der[0] !== 0x30 || der[1] !== der.length - 2) return null;
  const r = derInt(der, 2);
  const s = r && derInt(der, r.next);
  if (!r || !s || s.next !== der.length) return null;
  return Buffer.concat([r.value, s.value]);
}

function readClientData(bytes) {
  try {
    const parsed = JSON.parse(bytes.toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function signatureVerifies(publicKey, sig, signed) {
  const raw = derToRaw(sig);
  if (!raw) return false;
  try {
    const key = crypto.createPublicKey({ key: fromB64url(publicKey), format: "der", type: "spki" });
    return crypto.verify("sha256", signed, { key, dsaEncoding: "ieee-p1363" }, raw);
  } catch {
    return false;
  }
}

/**
 * @param {{ authenticatorData: string, clientDataJSON: string, signature: string }} assertion
 * @param {{ publicKey: string, counter: number }} pinned
 * @returns {{ ok: true, counter: number } | { ok: false, reason: string }}
 */
function verifyPasskeyAssertion(assertion, pinned, message, origins) {
  let auth, client, sig;
  try {
    auth = fromB64url(assertion.authenticatorData);
    client = fromB64url(assertion.clientDataJSON);
    sig = fromB64url(assertion.signature);
  } catch {
    return { ok: false, reason: "The passkey's answer isn't readable." };
  }
  const data = readClientData(client);
  if (!data || data.type !== "webauthn.get") return { ok: false, reason: "That isn't a passkey signature." };
  const allowed = origins.find((o) => o.origin === data.origin);
  if (!allowed || data.crossOrigin === true) return { ok: false, reason: "The passkey signed for another site." };
  if (data.challenge !== challengeFor(message)) return { ok: false, reason: "The passkey signed a different approval." };
  if (auth.length < 37 || !auth.subarray(0, 32).equals(sha256(allowed.rpId))) return { ok: false, reason: "The passkey belongs to another site." };
  const flags = auth[32];
  if (!(flags & FLAG_UP) || !(flags & FLAG_UV)) return { ok: false, reason: "The passkey didn't check it was you (Touch ID or a PIN)." };
  const counter = auth.readUInt32BE(33);
  if ((counter !== 0 || pinned.counter !== 0) && counter <= pinned.counter) return { ok: false, reason: "The passkey's counter went backwards: it may have been copied." };
  if (!signatureVerifies(pinned.publicKey, sig, Buffer.concat([auth, sha256(client)]))) return { ok: false, reason: "The passkey's signature doesn't check out." };
  return { ok: true, counter };
}

/**
 * The one dev origin main takes besides sign.weft.zip: only unpackaged, only with WEFT_PASSKEY_DEV=1 as well as
 * WEFT_PASSKEY_DEV_ORIGIN, and said out loud at startup, since it lets a page on that origin sign approvals.
 * @param {{ packaged: boolean, env: Record<string, string | undefined>, warn: (line: string) => void }} deps
 */
function passkeyDevOrigin({ packaged, env, warn }) {
  const origin = env.WEFT_PASSKEY_DEV_ORIGIN;
  if (packaged || env.WEFT_PASSKEY_DEV !== "1" || !origin) return null;
  warn(`[weft] Passkey approvals also accepted from ${origin} (WEFT_PASSKEY_DEV=1). Development only.`);
  return origin;
}

module.exports = { verifyPasskeyAssertion, passkeyOrigins, passkeyDevOrigin };
