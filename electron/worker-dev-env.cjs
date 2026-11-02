// Main's side of a Weft Worker's dev server env (docs/architecture/project-hosts.md#the-vault-and-connectors-on-a-worker-t2-as-built).
// A worker card's server asks with a signed `dev_env` device call; electron/worker-vault.cjs has already re-read the row,
// checked the signature against the pinned sign key and found the vault the card's own project names. This asks the user
// once, in the worker window, then holds a standing grant for that worker, card, vault, command and script for
// DEV_GRANT_HOURS, so a restart is sealed without another prompt. The vault's development set is sealed to the pinned
// box key for this card's ask and command and sent as a Mac-signed `secret_use` with `use: "dev"`.
const crypto = require("node:crypto");
const { LOADER_VAR } = require("./command-rules.cjs");
const { queueSecretUse } = require("./worker-ask-row.cjs");
const { seal } = require("./worker-seal.cjs");
const { DEV_GRANT_HOURS, devEnvPurpose } = require("./worker-vault-wire.cjs");

const GRANT_MS = DEV_GRANT_HOURS * 60 * 60_000;
const sha = (text) => crypto.createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");

/**
 * @param {{
 *   vault: { valuesForVault: (ref: { id: string, label: string }, names: null, environment: string, use: false) => Promise<{ values: Record<string, string> }> },
 *   ask: (request: { message: string, detail: string, reason: string, view: Record<string, unknown> }) => Promise<string | null>,
 *   describe: typeof import("./secret-run.cjs").describe,
 *   pins: { pin: (id: string, keys: { name: string, publicKey: string, signKey?: string }) => void },
 *   signer: () => Promise<{ publicKey: () => string, sign: (message: string) => string }>,
 *   audit?: (entry: Record<string, unknown>) => unknown,
 *   now?: () => number,
 * }} deps
 */
function createWorkerDevEnv({ vault, ask, describe, pins, signer, audit = (entry) => entry, now = Date.now }) {
  /** @type {Map<string, number>} grant key -> until */
  const grants = new Map();
  const keyOf = (worker, card, ref, a) => [worker.id, card, ref.id, sha(a.command), sha(a.script)].join("\n");

  // Whether the user allowed it: a live standing grant, else the worker window (pinning a first-seen key on a yes).
  async function allowed(ctx, names) {
    const { row, worker, a, pin, signKey, ref } = ctx;
    const key = keyOf(worker, row.card_id, ref, a);
    if ((grants.get(key) ?? 0) > now()) return "grant";
    const request = describe({ kind: "dev", command: a.command, cwd: a.cwd, script: a.script, names, environment: "development", label: ref.label, thread: a.thread, why: a.why, worker: worker.name, remote: a.remote, fingerprint: pin.fingerprint, firstUse: pin.firstUse });
    if (!(await ask(request))) return null;
    if (now() > a.expiresAt) throw new Error("The ask expired while it waited for you. Start the dev server again.");
    if (pin.firstUse || !pin.signKey) pins.pin(worker.id, { name: worker.name, publicKey: pin.publicKey, signKey });
    grants.set(key, now() + GRANT_MS);
    return "once";
  }

  return {
    /** @returns {Promise<{ queued?: true, denied?: true, none?: true, names?: string[], label: string }>} */
    async answer(ctx) {
      const { account, row, worker, a, pin, ref } = ctx;
      const { values: all } = await vault.valuesForVault(ref, null, "development", false);
      // A variable that loads code (NODE_OPTIONS, DYLD_*) never travels to a worker's server, whatever the vault holds.
      const values = Object.fromEntries(Object.entries(all).filter(([name]) => !LOADER_VAR.test(name)));
      const names = Object.keys(values);
      if (!names.length) return { none: true, label: ref.label };
      const via = await allowed(ctx, names);
      audit({ kind: "vault", action: "worker dev server", by: "thread", card: row.card_id, thread: a.thread, command: a.command, names, environment: "development", vault: ref.label, worker: worker.name, via: via ?? undefined, outcome: via ? "ok" : "denied" });
      if (!via) return { denied: true, label: ref.label };
      const plaintext = JSON.stringify({ v: 1, card: row.card_id, nonce: a.nonce, command: a.command, names, environment: "development", expiresAt: a.expiresAt, values });
      const sealed = seal(pin.publicKey, plaintext, devEnvPurpose(row.card_id, a.nonce, a.command));
      await queueSecretUse(account.supabase, row, worker, signer, a.nonce, sealed, { use: "dev" });
      return { queued: true, names, label: ref.label };
    },
    /** Ends a worker's standing dev grants (its connectors were turned off, or it was revoked). */
    forgetWorker(workerId) {
      for (const key of grants.keys()) if (key.startsWith(`${workerId}\n`)) grants.delete(key);
    },
  };
}

module.exports = { createWorkerDevEnv, GRANT_MS };
