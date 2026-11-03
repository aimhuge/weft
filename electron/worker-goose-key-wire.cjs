// Main's copy of lib/worker-goose-key-wire.ts (a worker card's Goose key, docs/architecture/weft-worker.md#goose-on-a-worker):
// the tool, the message a paired worker signs, the command the sealed answer names and its seal purpose. Held to the TS
// side by a test.
const crypto = require("node:crypto");

const GOOSE_KEY = "goose_key";
const GOOSE_KEY_ENVIRONMENT = "production";

/** @param {string} cardId @param {string} boxKey @param {{ nonce: string, expiresAt: number, providerId: string, baseUrl: string }} a */
function gooseKeyAskMessage(cardId, boxKey, a) {
  return JSON.stringify(["weft-goose-key-ask-v1", cardId, boxKey, a.nonce, a.expiresAt, a.providerId, a.baseUrl]);
}

/** @param {string} providerId @param {string} baseUrl */
const gooseKeyCommand = (providerId, baseUrl) => JSON.stringify(["goose", providerId, baseUrl]);

/** @param {string} card @param {string} nonce @param {string} command */
function gooseKeyPurpose(card, nonce, command) {
  return `goose-key:${card}:${nonce}:${crypto.createHash("sha256").update(command, "utf8").digest("hex")}`;
}

module.exports = { GOOSE_KEY, GOOSE_KEY_ENVIRONMENT, gooseKeyAskMessage, gooseKeyCommand, gooseKeyPurpose };
