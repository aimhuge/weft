// Main's half of the pairing and approval checks (docs/architecture/mobile-security.md). The same rules as
// lib/pairing-link.ts checkClaim and lib/approval-sig.ts verifyApproval, here because main can't load TypeScript;
// electron/pairing-crypto.test.ts proves the two agree byte for byte.
const ORIGINAL = 1; // sodium.base64_variants.ORIGINAL
const URLSAFE_NO_PADDING = 7; // sodium.base64_variants.URLSAFE_NO_PADDING

const KINDS = ["phone", "browser"];
const PLATFORMS = ["ios", "android", "web", "darwin"];

// A browser's passkey adds two lines (its credential id and SPKI public key); a claim without one reads as before.
const claimMessage = (pairingId, orgId, c) =>
  ["weft-pair-v1", pairingId, orgId, c.box_key, c.sign_key, c.name, c.platform, c.kind, ...(c.passkey_id ? [`passkey:${c.passkey_id}`, c.passkey_key] : [])].join("\n");

// The claim's passkey lines: both halves or neither, and only a browser's. A string says why not.
function claimPasskey({ kind, passkey_id, passkey_key }) {
  if (!passkey_id !== !passkey_key || (passkey_id && kind !== "browser")) return "The claim's passkey is incomplete.";
  return passkey_id ? { passkey_id, passkey_key } : {};
}

/**
 * Why the claim in a pairing row can't be trusted, or null when it can.
 * @param {any} sodium a ready libsodium
 * @param {{ id: string, orgId: string, secret: string }} link
 * @param {Record<string, unknown>} claim
 */
function checkClaim(sodium, link, claim) {
  const { name, platform, kind, box_key, sign_key, proof, sig } = claim;
  if (!name || !platform || !kind || !box_key || !sign_key || !proof || !sig) return "The claim is missing a field.";
  if (!KINDS.includes(String(kind)) || !PLATFORMS.includes(String(platform))) return "The claim names an unknown kind of device.";
  const passkey = claimPasskey(claim);
  if (typeof passkey === "string") return passkey;
  const message = sodium.from_string(claimMessage(link.id, link.orgId, { name, platform, kind, box_key, sign_key, ...passkey }));
  try {
    if (!sodium.crypto_auth_verify(sodium.from_base64(String(proof), ORIGINAL), message, sodium.from_base64(link.secret, URLSAFE_NO_PADDING)))
      return "The claim wasn't made with this code.";
    if (!sodium.crypto_sign_verify_detached(sodium.from_base64(String(sig), ORIGINAL), message, sodium.from_base64(String(sign_key), ORIGINAL)))
      return "The claim's signature doesn't match its key.";
  } catch {
    return "The claim isn't readable.";
  }
  return null;
}

/** @returns {boolean} */
function verifySignature(sodium, message, sig, signKey) {
  try {
    return sodium.crypto_sign_verify_detached(sodium.from_base64(String(sig), ORIGINAL), sodium.from_string(String(message)), sodium.from_base64(String(signKey), ORIGINAL));
  } catch {
    return false;
  }
}

const newSecret = (sodium) => sodium.to_base64(sodium.randombytes_buf(32), URLSAFE_NO_PADDING);

const PAIR_URL = "https://weft.zip/pair";
// A passkey pairing opens on sign.weft.zip (lib/sign-origin.ts), so its secret never reaches a weft.zip page.
const SIGN_PAIR_URL = "https://sign.weft.zip/pair";
function pairingLink({ id, secret, orgId, mac }, base = PAIR_URL) {
  return `${base}#${new URLSearchParams({ v: "1", p: id, s: secret, o: orgId, m: mac }).toString()}`;
}

// The code the sign.weft.zip page shows for a passkey (lib/passkey-code.ts): SHA-256 of its SPKI key, 4 bytes, XXXX-XXXX.
function passkeyCode(publicKey) {
  const hex = require("node:crypto").createHash("sha256").update(Buffer.from(String(publicKey), "base64url")).digest("hex").slice(0, 8).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

module.exports = { checkClaim, verifySignature, newSecret, pairingLink, claimMessage, passkeyCode, SIGN_PAIR_URL };
