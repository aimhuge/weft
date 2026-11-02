// A worker card's vault ask as main reads it off its device_calls row (electron/worker-vault.cjs). Like a run's ask
// (electron/worker-ask.cjs), nothing in it is trusted: each field is checked and capped for the tool it's for, a name
// may not be one that loads code, and anything the approval window shows may hold no control, format or bidi character.
const { checkCommand, LOADER_VAR } = require("./command-rules.cjs");
const { capped, expiryOf, plain, MAX_COMMAND, MAX_SCRIPT, MAX_THREAD, MAX_WHY } = require("./worker-ask.cjs");
const { DEV_ENV, VAULT_BLANK, VAULT_LIST, VAULT_PUSH, VAULT_SET } = require("./worker-vault-wire.cjs");

const ENVIRONMENTS = ["development", "preview", "production"];
const NONCE = /^[0-9a-f]{64}$/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SEALED = /^[A-Za-z0-9+/=]{1,40000}$/;
const MAX_HINT = 400;

const BAD = "That vault ask isn't one Weft makes.";

/** @param {unknown} v @returns {string} */
function nameOf(v) {
  if (typeof v !== "string" || !NAME.test(v) || v.length > 200) throw new Error(BAD);
  if (LOADER_VAR.test(v)) throw new Error(`${v} makes a program load code, so a worker can't put it in the vault.`);
  return v;
}

/** @param {unknown} v @returns {string} */
function environmentOf(v) {
  const env = ENVIRONMENTS.find((e) => e === v);
  if (!env) throw new Error(BAD);
  return env;
}

// Each tool's own fields, checked; what isn't listed for a tool is dropped, so the signature can't cover a field main ignores.
const FIELDS = {
  [VAULT_LIST]: () => ({}),
  [VAULT_BLANK]: (a) => {
    if (!Array.isArray(a.names) || !a.names.length || a.names.length > 20) throw new Error(BAD);
    return { names: a.names.map(nameOf), environment: environmentOf(a.environment), hint: plain(a.hint, MAX_HINT, "hint") };
  },
  [VAULT_SET]: (a) => {
    if (typeof a.sealed !== "string" || !SEALED.test(a.sealed)) throw new Error(BAD);
    return { name: nameOf(a.name), environment: environmentOf(a.environment), replace: a.replace === true, sealed: a.sealed };
  },
  [VAULT_PUSH]: (a) => ({ name: nameOf(a.name), environment: environmentOf(a.environment) }),
  [DEV_ENV]: (a) => {
    const command = typeof a.command === "string" && a.command.length <= MAX_COMMAND ? a.command.trim() : "";
    if (!command) throw new Error(BAD);
    checkCommand(command);
    return { command, cwd: plain(a.cwd ?? ".", 1_000, "folder") ?? ".", script: plain(a.script, MAX_SCRIPT, "script", true), thread: capped(a.thread, MAX_THREAD), why: capped(a.why, MAX_WHY) };
  },
};

/**
 * @param {string} tool @param {unknown} raw @param {number} now
 * @returns {{ nonce: string, expiresAt: number, remote: string, sig?: string, [field: string]: unknown }}
 */
function vaultAskOf(tool, raw, now) {
  const a = /** @type {Record<string, unknown>} */ (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {});
  const fields = FIELDS[tool];
  const nonce = typeof a.nonce === "string" && NONCE.test(a.nonce) ? a.nonce : null;
  const remote = plain(a.remote, 500, "git remote");
  if (!fields || !nonce || !remote) throw new Error(BAD);
  return { nonce, expiresAt: expiryOf(a.expiresAt, now), remote, ...fields(a), sig: typeof a.sig === "string" ? a.sig : undefined };
}

module.exports = { vaultAskOf };
