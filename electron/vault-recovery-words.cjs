// A vault's recovery key as words the user writes down (docs/architecture/teams-vault.md, "Recovery
// key"). The words are the recovery key: 24 of them, from the standard 2048-word BIP-39 English
// list, and no checksum (the design says so — the words are for the user to write down, the math is
// libsodium's).
//
// The encoding, in one paragraph:
//
//   A word is 11 bits (2048 words = 2^11). 24 words carry 264 bits. A libsodium keypair seed is
//   32 bytes = 256 bits. So the seed is the first 23 words (253 bits) plus the top 3 bits of the
//   24th word, and the 24th word's remaining 8 bits are zero.
//
// Zeroing those 8 bits is what makes the encoding exact. Every 24-word string decodes to exactly
// one seed, and every seed encodes to exactly one 24-word string — but only the strings whose
// 24th word has those 8 bits zero are *canonical*. A word mistyped into the 24th position usually
// lands on a non-canonical string, and the decoder says so instead of deriving a key that opens
// nothing. (A mistype in the first 23 positions silently derives a different key, which fails at
// the unwrap instead — the same failure a wrong passphrase gives, and the same advice: try again.)
//
// The passphrase (Q2) sits on top: the seed the words carry is run through scrypt with the vault's
// id as the salt, so the same passphrase on a different vault derives a different key. The words
// alone are then not enough — a screenshot of the words on its own doesn't open the vault.
//
// Nothing here is written down. The words exist in memory while the user reads them, and the seed
// is derived from them on demand.
const crypto = require("node:crypto");
const WORDS = require("./recovery-wordlist.json");

// The words a recovery key is.
const WORD_COUNT = 24;
// The bits one word carries: 2048 words is 2^11.
const BITS_PER_WORD = 11;
// The bits the seed needs: a libsodium keypair seed is 32 bytes.
const SEED_BITS = 256;
// The bytes the seed is.
const SEED_BYTES = SEED_BITS / 8;
// The words whose bits carry the seed: 23 words is 253 bits, and the 24th word's top 3 bits finish
// the 256. So the 24th word is the "check" word.
const SEED_WORDS = 23;
// The bits the 24th word contributes.
const LAST_BITS = SEED_BITS - SEED_WORDS * BITS_PER_WORD;
// The mask the 24th word's low bits must be clear for the string to be canonical.
const LOW_MASK = (1 << (BITS_PER_WORD - LAST_BITS)) - 1;

// The index of each word in the list, so an encode is a lookup and a decode is a lookup too.
const INDEX = new Map(WORDS.map((word, i) => [word, i]));

// scrypt's cost. Node's default (N=16384, r=8, p=1) is the interactive-login setting: about 100ms
// on an M-series Mac, which is slow enough to make a stolen wordlist expensive and fast enough that
// the user doesn't wait on it.
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/**
 * The wordlist's index of a word, or null when it isn't in the list.
 * @param {string} word
 * @returns {number|null}
 */
function wordIndex(word) {
  if (typeof word !== "string") return null;
  return INDEX.has(word.trim().toLowerCase()) ? INDEX.get(word.trim().toLowerCase()) : null;
}

/**
 * The seed the words carry, as 32 bytes.
 *
 * The words are the seed itself when there's no passphrase: the passphrase path runs the seed
 * through scrypt first, and the words carry the *result* of that, so the words are always exactly
 * the 32 bytes the keypair is derived from.
 *
 * @param {string[]} words
 * @returns {Buffer}
 */
function seedFromWords(words) {
  if (!Array.isArray(words) || words.length !== WORD_COUNT) throw new Error(`A recovery key is ${WORD_COUNT} words.`);
  const bits = [];
  for (const word of words) {
    const index = wordIndex(word);
    if (index === null) throw new Error("That's not a recovery word.");
    for (let b = BITS_PER_WORD - 1; b >= 0; b--) bits.push((index >> b) & 1);
  }
  // The seed is the first 256 bits: 23 whole words and the 24th word's top 3.
  const bytes = Buffer.alloc(SEED_BYTES);
  for (let i = 0; i < SEED_BITS; i++) {
    if (bits[i]) bytes[i >> 3] |= 1 << (7 - (i & 7));
  }
  // The 24th word's low 8 bits must be zero, or the words weren't produced by our encoder — most
  // likely a typo. Saying so beats deriving a key that opens nothing.
  const last = wordIndex(words[WORD_COUNT - 1]);
  if (last === null || (last & LOW_MASK) !== 0) throw new Error("That recovery key isn't one of ours — check the last word.");
  return bytes;
}

/**
 * The 24 words that carry a seed.
 * @param {Buffer|Uint8Array} seed
 * @returns {string[]}
 */
function wordsFromSeed(seed) {
  const bytes = Buffer.from(seed);
  if (bytes.length !== SEED_BYTES) throw new Error("A recovery seed is 32 bytes.");
  const bits = [];
  for (const byte of bytes) for (let b = 7; b >= 0; b--) bits.push((byte >> b) & 1);
  const words = [];
  for (let w = 0; w < WORD_COUNT; w++) {
    let index = 0;
    for (let i = 0; i < BITS_PER_WORD; i++) index = (index << 1) | (bits[w * BITS_PER_WORD + i] ?? 0);
    // The last word's low bits are zero by construction, so the string is canonical.
    words.push(WORDS[index]);
  }
  return words;
}

/**
 * The seed a passphrase derives from the words' seed: scrypt(passphrase, vault_id).
 *
 * The vault id is the salt, so the same passphrase on a different vault derives a different key —
 * a paper backup of one vault's words can't open another vault even with the same passphrase.
 *
 * @param {Buffer} seed the seed the words carry
 * @param {string} passphrase
 * @param {string} vaultId the salt: the vault the key belongs to
 * @returns {Buffer}
 */
function deriveSeed(seed, passphrase, vaultId) {
  if (!passphrase) return Buffer.from(seed);
  if (!vaultId) throw new Error("A recovery key needs its vault to derive from.");
  return crypto.scryptSync(passphrase, Buffer.from(vaultId, "utf8"), SEED_BYTES, SCRYPT);
}

/**
 * The words for a seed, with the passphrase already applied.
 * @param {Buffer|Uint8Array} seed
 * @param {string} passphrase
 * @param {string} vaultId
 * @returns {string[]}
 */
function wordsFor(seed, passphrase, vaultId) {
  return wordsFromSeed(deriveSeed(Buffer.from(seed), passphrase, vaultId));
}

/**
 * The seed the words mean, with the passphrase applied.
 * @param {string[]} words
 * @param {string} passphrase
 * @param {string} vaultId
 * @returns {Buffer}
 */
function seedFor(words, passphrase, vaultId) {
  return deriveSeed(seedFromWords(words), passphrase, vaultId);
}

/**
 * The words a user pastes, cleaned up: trimmed, lowercased, any punctuation or extra spaces
 * dropped. The user types them from a piece of paper, so they come with commas and odd spacing.
 * @param {string|string[]} input
 * @returns {string[]}
 */
function parseWords(input) {
  const raw = Array.isArray(input) ? input.join(" ") : String(input ?? "");
  return raw
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

module.exports = { WORD_COUNT, SEED_BYTES, WORDS, wordIndex, seedFromWords, wordsFromSeed, deriveSeed, wordsFor, seedFor, parseWords };
