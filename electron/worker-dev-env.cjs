// Main's side of a Weft Worker's dev server env (docs/architecture/project-hosts.md#the-vault-on-a-worker-t2-as-built).
// A worker card's server asks with a signed `dev_env` device call; electron/worker-vault.cjs has already re-read the row,
// checked the signature against the pinned sign key and found the vault the card's own project names. Every start and
// every restart asks the user in the worker window: there's no standing grant on a worker, because this Mac can't tell
// what started the turn (its own board, weft.zip, a direct line), and a stolen web session must not reach a running
// grant. The vault's development set is sealed to the pinned box key for this card's ask and command and sent as a
// Mac-signed `secret_use` with `use: "dev"`.
const { LOADER_VAR } = require("./command-rules.cjs");
const { queueSecretUse } = require("./worker-ask-row.cjs");
const { seal } = require("./worker-seal.cjs");
const { splitKept, withKept } = require("./worker-kept.cjs");
const { devEnvPurpose } = require("./worker-vault-wire.cjs");

/**
 * @param {{
 *   vault: { valuesForVault: (ref: { id: string, label: string }, names: null, environment: string, use: false) => Promise<{ values: Record<string, string> }> },
 *   ask: (request: { message: string, detail: string, reason: string, view: Record<string, unknown> }) => Promise<string | null>,
 *   describe: typeof import("./secret-run.cjs").describe,
 *   pins: { pin: (id: string, keys: { name: string, publicKey: string, signKey?: string }) => void },
 *   signer: () => Promise<{ publicKey: () => string, sign: (message: string) => string }>,
 *   audit?: (entry: Record<string, unknown>) => unknown,
 *   kept?: ReturnType<typeof import("./worker-kept.cjs").createKeptRecord>,
 *   now?: () => number,
 * }} deps
 */
function createWorkerDevEnv({ vault, ask, describe, pins, signer, audit = (entry) => entry, kept, now = Date.now }) {
  // Whether the user allowed it, in the worker window (pinning a first-seen key on a yes). Asked every time.
  async function allowed(ctx, names) {
    const { worker, a, pin, signKey, ref } = ctx;
    const request = describe({ kind: "dev", command: a.command, cwd: a.cwd, script: a.script, names, environment: "development", label: ref.label, thread: a.thread, why: a.why, worker: worker.name, remote: a.remote, fingerprint: pin.fingerprint, firstUse: pin.firstUse });
    if (!(await ask(request))) return null;
    if (now() > a.expiresAt) throw new Error("The ask expired while it waited for you. Start the dev server again.");
    if (pin.firstUse || !pin.signKey) pins.pin(worker.id, { name: worker.name, publicKey: pin.publicKey, signKey });
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
      // Values kept on the worker, unchanged since, open from its own copy (electron/worker-kept.cjs).
      const split = kept ? splitKept(kept, worker.id, ref.id, "development", values, row.args?.kept) : { values, kept: {} };
      const plaintext = JSON.stringify(withKept({ v: 1, card: row.card_id, nonce: a.nonce, command: a.command, names, environment: "development", expiresAt: a.expiresAt }, split));
      const sealed = seal(pin.publicKey, plaintext, devEnvPurpose(row.card_id, a.nonce, a.command));
      await queueSecretUse(account.supabase, row, worker, signer, a.nonce, sealed, { use: "dev" });
      return { queued: true, names, label: ref.label };
    }
  };
}

module.exports = { createWorkerDevEnv };
