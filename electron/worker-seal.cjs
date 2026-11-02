// Main's half of lib/worker-seal.ts: sealing a secret to one Weft Worker's X25519 key, for a worker's secret run
// (electron/worker-secret.cjs). Main can't load a .ts module, so this is the same construction, held to lib's `open` by
// a round-trip test: a fresh ephemeral key, X25519 to a shared secret, HKDF-SHA256 to an AES-256-GCM key bound to both
// public keys and to what the secret is for. Main only seals; the worker opens.
const crypto = require("node:crypto");

const b64 = (buf) => buf.toString("base64");
const pub = (der) => crypto.createPublicKey({ key: Buffer.from(der, "base64"), format: "der", type: "spki" });
const derOf = (key) => b64(key.export({ format: "der", type: "spki" }));

/**
 * @param {string} recipientPublicKey the worker's public_key, base64 DER (SPKI)
 * @param {string} plaintext
 * @param {string} purpose
 * @returns {{ v: 1, epk: string, iv: string, ct: string, tag: string }}
 */
function seal(recipientPublicKey, plaintext, purpose) {
  const recipient = pub(recipientPublicKey);
  const eph = crypto.generateKeyPairSync("x25519");
  const epk = derOf(eph.publicKey);
  const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: recipient });
  const key = Buffer.from(crypto.hkdfSync("sha256", shared, Buffer.from(epk + recipientPublicKey), Buffer.from(`weft-worker-seal:${purpose}`), 32));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { v: 1, epk, iv: b64(iv), ct: b64(ct), tag: b64(cipher.getAuthTag()) };
}

// What a secret_use is sealed for (lib/secret-use.ts secretUsePurpose): one card, one ask, one exact command.
/** @param {string} card @param {string} nonce @param {string} command */
function secretUsePurpose(card, nonce, command) {
  return `secret-use:${card}:${nonce}:${crypto.createHash("sha256").update(command, "utf8").digest("hex")}`;
}

// What main signs for a secret_use (lib/secret-use.ts secretUseMessage): the card, the ask and the sealed bytes.
/** @param {string} card @param {string} nonce @param {{ epk: string, iv: string, ct: string, tag: string }} sealed */
function secretUseMessage(card, nonce, sealed) {
  return ["weft-secret-use-v1", card, nonce, sealed.epk, sealed.iv, sealed.ct, sealed.tag].join("\n");
}

module.exports = { seal, secretUsePurpose, secretUseMessage };
