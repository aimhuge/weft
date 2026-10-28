// A device's fingerprint: the TOFU check's whole point (docs/architecture/teams-vault.md, "The
// fingerprint UI"). A device's public key is shown to the user and to the team, so both machines
// print the same short string and the user reads it out and compares it — a server that slipped in
// its own key would print two different fingerprints and the comparison fails before any wrapped key
// is produced.
//
// The value: the first 16 bytes of SHA-256 of the device's public key, base64-decoded, as 32
// lowercase hex characters. The display form groups those 32 characters into 8 groups of 4:
// `a1b2c3d4 e5f67890 abcdef01 23456789 ...` — the same shape lib/team-devices-view.ts formats on
// the web side, so both sides print the same string for the same key.
//
// The public key is an X25519 key in base64 (electron/vault-crypto.cjs's newKeypair), so it is
// base64-decoded before hashing. A fingerprint is not a secret: it is shown to the user on purpose.
const crypto = require("node:crypto");

// The bytes of SHA-256 a fingerprint covers: the first 16.
const FINGERPRINT_BYTES = 16;
// The bytes of an X25519 public key.
const KEY_BYTES = 32;
// The hex characters those bytes make: two per byte.
const HEX_LENGTH = FINGERPRINT_BYTES * 2;
// How many hex characters one displayed group holds.
const GROUP = 4;
// How many groups the display form has: 32 characters in groups of 4.
const GROUPS = HEX_LENGTH / GROUP;
// The characters a fingerprint may be made of once the separators are gone.
const HEX_ONLY = /^[0-9a-f]+$/;

/**
 * The canonical fingerprint of a device's public key: 32 lowercase hex characters.
 * @param {string} publicKey the device's base64 X25519 public key
 * @returns {string}
 */
function fingerprint(publicKey) {
  if (typeof publicKey !== "string" || !publicKey) throw new Error("A device needs a public key to have a fingerprint.");
  const raw = Buffer.from(publicKey, "base64");
  // An X25519 public key is 32 bytes. Node's base64 decoder quietly skips the characters it can't
  // read, so a string that isn't a key at all can decode to something; the length is the check
  // that says "this is a key".
  if (raw.length !== KEY_BYTES) throw new Error("That public key isn't a 32-byte X25519 key, so it has no fingerprint.");
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, HEX_LENGTH);
}

/**
 * Strip everything that isn't a hex character, so "a1b2-c3d4", "a1b2 c3d4" and "A1B2C3D4" all
 * reduce to the same 32 characters. Returns null when what is left isn't exactly a 32-character
 * hex string — the same rule as lib/team-devices-view.ts's normalizeFingerprint, so a fingerprint
 * the user pasted compares the same on both sides.
 * @param {string|null|undefined} raw
 * @returns {string|null}
 */
function normalizeFingerprint(raw) {
  if (typeof raw !== "string") return null;
  const hex = raw.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hex.length !== HEX_LENGTH) return null;
  if (!HEX_ONLY.test(hex)) return null;
  return hex;
}

/**
 * The display form: 8 groups of 4, separated by single spaces — the shape
 * lib/team-devices-view.ts's formatFingerprint produces. A fingerprint we can't parse comes back
 * as the raw string, so a caller shows something rather than nothing.
 * @param {string|null|undefined} raw
 * @returns {string}
 */
function formatFingerprint(raw) {
  const hex = normalizeFingerprint(raw);
  if (!hex) return typeof raw === "string" ? raw.trim() : "";
  const groups = [];
  for (let i = 0; i < GROUPS; i++) groups.push(hex.slice(i * GROUP, i * GROUP + GROUP));
  return groups.join(" ");
}

/**
 * Whether a fingerprint the user pasted can be compared. The paste is what the other machine
 * showed, so it may be in any of the shapes above.
 * @param {string|null|undefined} raw
 * @returns {boolean}
 */
function isValidFingerprint(raw) {
  return normalizeFingerprint(raw) !== null;
}

module.exports = { fingerprint, normalizeFingerprint, formatFingerprint, isValidFingerprint, FINGERPRINT_BYTES, HEX_LENGTH };
