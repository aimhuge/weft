// Main's copy of lib/worker-vault-wire.ts (a worker card's vault asks, docs/architecture/project-hosts.md#the-vault-on-a-worker-t2-as-built):
// the tools, the message a paired worker signs and the dev env's seal purpose. Held to the TS side by a test.
const crypto = require("node:crypto");

const VAULT_LIST = "vault_list";
const VAULT_BLANK = "vault_blank";
const VAULT_SET = "vault_set";
const VAULT_PUSH = "vault_push";
const DEV_ENV = "dev_env";
const VAULT_TOOLS = new Set([VAULT_LIST, VAULT_BLANK, VAULT_SET, VAULT_PUSH, DEV_ENV]);
// How long a worker's dev server approval covers its restarts (electron/worker-dev-env.cjs, the window's words).
const DEV_GRANT_HOURS = 2;

/** @param {string} cardId @param {string} boxKey @param {string} tool @param {Record<string, any>} a */
function vaultAskMessage(cardId, boxKey, tool, a) {
  return JSON.stringify(["weft-vault-ask-v1", cardId, boxKey, tool, a.nonce, a.expiresAt, a.remote, a.environment ?? null, a.names ?? null, a.name ?? null, a.hint ?? null, a.replace === true, a.sealed ?? null, a.command ?? null, a.cwd ?? null, a.script ?? null]);
}

/** @param {string} card @param {string} nonce @param {string} command */
function devEnvPurpose(card, nonce, command) {
  return `dev-env:${card}:${nonce}:${crypto.createHash("sha256").update(command, "utf8").digest("hex")}`;
}

module.exports = { VAULT_LIST, VAULT_BLANK, VAULT_SET, VAULT_PUSH, DEV_ENV, VAULT_TOOLS, DEV_GRANT_HOURS, vaultAskMessage, devEnvPurpose };
