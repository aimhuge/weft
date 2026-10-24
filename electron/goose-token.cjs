// Goose's provider keys, one per provider, sealed by safeStorage (the Keychain).
//
// A user may configure several providers (OpenRouter, Anthropic, a custom OpenAI-compatible endpoint), so this is a
// map of provider → record, not the one-record-per-file shape electron/provider-token.cjs keeps. That module's
// writeToken writes ONE record to ONE file, so it can't hold a map; what it does give us is requireKeychain, the
// refusal before anything is written when the Keychain can't encrypt.
//
// The file is ~/.weft/goose-tokens.json at 0600 (the directory 0700): `{ providers: { <id>: { token, savedAt,
// baseUrl?, model? } }, updatedAt }`. The token is base64 of safeStorage's encrypted bytes; baseUrl and model are
// not secrets (an endpoint and the model it serves), so they sit in the clear beside it.
//
// The plaintext never leaves this file's owner: main reads it to put the key in a Goose subprocess's env. The board
// only ever learns whether a provider has a key, and the metadata beside it (electron/goose-token.cjs's list()).

const fs = require("node:fs");
const path = require("node:path");
const { requireKeychain } = require("./provider-token.cjs");

const TOKEN_FILE = "goose-tokens.json";

/**
 * A saved provider: the token (base64 of safeStorage's encrypted bytes), when it was saved, and the non-secret
 * metadata the user set (a custom endpoint and the model it serves).
 * @typedef {{ token: string, savedAt: string, baseUrl?: string, model?: string }} GooseProviderRecord
 */

/**
 * Electron's safeStorage, or a fake of the three methods used here.
 * @typedef {{ isEncryptionAvailable(): boolean, encryptString(text: string): Buffer, decryptString(buf: Buffer): string }} Keychain
 */

/** The absolute path of the store, for a data dir (the app's ~/.weft). */
function gooseTokenFile(dataDir) {
  return path.join(dataDir, TOKEN_FILE);
}

// The whole file as it is on disk, or an empty store when there is none yet.
function readStore(file) {
  if (!fs.existsSync(file)) return { providers: {} };
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return { providers: data.providers ?? {} };
}

// Written at 0600, the directory at 0700. writeFileSync's `mode` only applies when it CREATES the file — a rewrite
// keeps whatever mode the file had — so it's chmod'd after the write too (electron/provider-token.cjs).
function writeStore(file, store) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(path.dirname(file), 0o700);
  } catch {
    // The directory was just made, or it isn't ours to tighten: the file's own mode is the point.
  }
  fs.writeFileSync(file, JSON.stringify({ ...store, updatedAt: new Date().toISOString() }), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/**
 * Every provider with its token decrypted, keyed by provider id. {} when nothing is saved yet.
 * @param {Keychain} safeStorage
 * @param {string} file
 * @returns {Record<string, GooseProviderRecord & { token: string }>}
 */
function readGooseTokens(safeStorage, file) {
  const store = readStore(file);
  const out = {};
  for (const [id, record] of Object.entries(store.providers)) {
    out[id] = { ...record, token: safeStorage.decryptString(Buffer.from(record.token, "base64")) };
  }
  return out;
}

/**
 * One provider's record with its token decrypted, or null when there is none.
 * @param {Keychain} safeStorage
 * @param {string} file
 * @param {string} providerId
 */
function readGooseProvider(safeStorage, file, providerId) {
  const all = readGooseTokens(safeStorage, file);
  return all[String(providerId)] ?? null;
}

/**
 * Saves a provider's key, and returns the record. `extra` carries the non-secret metadata (baseUrl, model).
 * @param {Keychain} safeStorage
 * @param {string} file
 * @param {string} providerId
 * @param {string} token
 * @param {{ baseUrl?: string, model?: string }} [extra]
 * @returns {GooseProviderRecord}
 */
function writeGooseProvider(safeStorage, file, providerId, token, extra = {}) {
  const id = String(providerId ?? "").trim();
  if (!id) throw new Error("Which provider is this key for?");
  const value = String(token ?? "").trim();
  if (!value) throw new Error("Paste the provider's API key.");
  // Refuse before anything is written, so no plaintext key ever reaches the disk.
  requireKeychain(safeStorage, "Goose provider key");
  const store = readStore(file);
  const { baseUrl, model } = extra;
  const record = {
    token: safeStorage.encryptString(value).toString("base64"),
    savedAt: new Date().toISOString(),
    ...(baseUrl ? { baseUrl: String(baseUrl) } : {}),
    ...(model ? { model: String(model) } : {}),
  };
  store.providers[id] = record;
  writeStore(file, store);
  return record;
}

/**
 * Removes a provider's key. Returns whether there was one.
 * @param {Keychain} safeStorage
 * @param {string} file
 * @param {string} providerId
 */
function forgetGooseProvider(safeStorage, file, providerId) {
  const id = String(providerId ?? "").trim();
  const store = readStore(file);
  if (!store.providers[id]) return { removed: false };
  delete store.providers[id];
  writeStore(file, store);
  return { removed: true };
}

/**
 * What the board sees: for each provider, whether a key is saved and the metadata beside it. Never a token.
 * @param {Keychain} safeStorage
 * @param {string} file
 * @returns {Record<string, { savedAt?: string, baseUrl?: string, model?: string }>}
 */
function listGooseProviders(safeStorage, file) {
  const store = readStore(file);
  const out = {};
  for (const [id, record] of Object.entries(store.providers)) {
    out[id] = {
      savedAt: record.savedAt,
      ...(record.baseUrl ? { baseUrl: record.baseUrl } : {}),
      ...(record.model ? { model: record.model } : {}),
    };
  }
  return out;
}

module.exports = {
  TOKEN_FILE,
  gooseTokenFile,
  readGooseTokens,
  readGooseProvider,
  writeGooseProvider,
  forgetGooseProvider,
  listGooseProviders,
};
