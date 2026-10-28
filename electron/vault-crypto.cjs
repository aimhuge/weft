// The vault's cryptography (docs/architecture/secrets.md, "Keys"), on libsodium rather than hand-rolled on
// node:crypto: a device keypair (X25519), a random vault key sealed to each device's public key, and secret
// values under XChaCha20-Poly1305 with the vault, name, environment and key version bound in as associated
// data, so a ciphertext copied onto another name or environment fails to open instead of decrypting.
const sodiumModule = require("libsodium-wrappers");

let sodium;
async function ready() {
  if (!sodium) {
    await sodiumModule.ready;
    sodium = sodiumModule;
  }
  return sodium;
}

function need() {
  if (!sodium) throw new Error("Call ready() before using the vault's crypto.");
  return sodium;
}

const toB64 = (bytes) => Buffer.from(bytes).toString("base64");
const fromB64 = (text) => new Uint8Array(Buffer.from(text, "base64"));

/** @returns {{ publicKey: string, privateKey: string }} */
function newKeypair() {
  const { publicKey, privateKey } = need().crypto_box_keypair();
  return { publicKey: toB64(publicKey), privateKey: toB64(privateKey) };
}

/** @returns {string} */
function newVaultKey() {
  return toB64(need().crypto_aead_xchacha20poly1305_ietf_keygen());
}

// Random bytes, for the seeds the recovery key is made of (electron/vault-recovery-words.cjs).
/** @returns {Uint8Array} */
function randomBytes(count) {
  return need().randombytes_buf(count);
}

// A keypair from a seed, so the same seed always gives the same keypair. The recovery key is this:
// its words carry a seed, and the seed is turned back into the keypair on the machine that
// recovers (electron/vault-recovery.cjs).
/** @returns {{ publicKey: string, privateKey: string }} */
function seedKeypair(seed) {
  const { publicKey, privateKey } = need().crypto_box_seed_keypair(seed);
  return { publicKey: toB64(publicKey), privateKey: toB64(privateKey) };
}

// Seals a vault key to a device: only that device's private key opens it.
/** @returns {string} */
function wrapKey(vaultKey, publicKey) {
  return toB64(need().crypto_box_seal(fromB64(vaultKey), fromB64(publicKey)));
}

/** @returns {string} */
function unwrapKey(wrapped, keypair) {
  return toB64(need().crypto_box_seal_open(fromB64(wrapped), fromB64(keypair.publicKey), fromB64(keypair.privateKey)));
}

// What a value is bound to. Newlines can't appear in a vault id, a variable name or an environment.
function aad(vaultId, name, environment, keyVersion) {
  return `${vaultId}\n${name}\n${environment}\n${keyVersion}`;
}

/** @returns {{ ciphertext: string, nonce: string }} */
function encrypt(value, vaultKey, data) {
  const s = need();
  const nonce = s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext = s.crypto_aead_xchacha20poly1305_ietf_encrypt(s.from_string(value), s.from_string(data), null, nonce, fromB64(vaultKey));
  return { ciphertext: toB64(ciphertext), nonce: toB64(nonce) };
}

// Throws when the key, the nonce or the associated data don't match.
/** @returns {string} */
function decrypt({ ciphertext, nonce }, vaultKey, data) {
  const s = need();
  const plain = s.crypto_aead_xchacha20poly1305_ietf_decrypt(null, fromB64(ciphertext), s.from_string(data), fromB64(nonce), fromB64(vaultKey));
  return s.to_string(plain);
}

module.exports = { ready, newKeypair, newVaultKey, randomBytes, seedKeypair, wrapKey, unwrapKey, aad, encrypt, decrypt };
