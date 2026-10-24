// The signing secret encryption the deployed relay needs (lib/relay-secret.ts, lib/webhook-relay.ts). The
// plaintext lives in the user's Mac vault only; the local Weft (this process) seals it with the AES-256-GCM
// key the deployment hands us through WEFT_RELAY_SECRET_KEY, and the deployed relay opens the same way.
// Same shape, same nonce length, same hex encode as the server-side helpers.

const { createCipheriv, randomBytes } = require("node:crypto");

const NONCE_BYTES = 12;
const ALGO = "aes-256-gcm";
const HEX_64 = /^[0-9a-f]{64}$/i;

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ id: string, key: Buffer } | null}
 */
function relayKeyFromEnv(env = process.env) {
  const hex = env.WEFT_RELAY_SECRET_KEY || "";
  if (!HEX_64.test(hex)) return null;
  return { id: (env.WEFT_RELAY_SECRET_KEY_ID || "").trim() || "v1", key: Buffer.from(hex, "hex") };
}

/**
 * @param {string} plain
 * @param {{ id: string, key: Buffer }} key
 * @returns {{ ciphertext: Buffer, nonce: Buffer, keyId: string }}
 */
function sealSecret(plain, key) {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGO, key.key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext, nonce, keyId: key.id };
}

function sealedToHex(sealed) {
  return {
    secret_ciphertext: sealed.ciphertext.toString("hex"),
    secret_nonce: sealed.nonce.toString("hex"),
    secret_key_id: sealed.keyId,
  };
}

module.exports = { relayKeyFromEnv, sealSecret, sealedToHex };
