// Main's side of a Weft Worker's dev server env (docs/architecture/project-hosts.md#the-vault-on-a-worker-t2-as-built).
// A worker card's server asks with a signed `dev_env` device call; electron/worker-vault.cjs has already re-read the row,
// checked the signature against the pinned sign key and found the vault the card's own project names. This asks the user
// once, in the worker window, then holds a standing grant for DEV_GRANT_HOURS, so a restart is sealed without another
// prompt. The grant is keyed on everything the values go to: the worker and its pinned box key, the card, the vault, the
// command, its package.json script, the folder, the names, and the card's latest instruction. Any new message to the
// card (from this Mac's board or from weft.zip, which this Mac can't tell apart and a stolen web session could send)
// is a new instruction, so its thread's next start asks again; so does a re-pinned key, until the Allow pins it. The vault's development set is sealed to the pinned
// box key for this card's ask and command and sent as a Mac-signed `secret_use` with `use: "dev"`.
const crypto = require("node:crypto");
const { LOADER_VAR } = require("./command-rules.cjs");
const { queueSecretUse } = require("./worker-ask-row.cjs");
const { seal } = require("./worker-seal.cjs");
const { DEV_GRANT_HOURS, devEnvPurpose } = require("./worker-vault-wire.cjs");

const GRANT_MS = DEV_GRANT_HOURS * 60 * 60_000;
const sha = (text) => crypto.createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
// The commands that tell a worker's card what to do; a secret_use (the answer to this very ask) isn't one.
const INSTRUCTIONS = ["new_card", "run", "reply", "answer", "host", "mode", "stop"];

// The id of the card's latest instruction, read with the owner's session, or null when it can't be read (no grant then).
async function latestInstruction(supabase, workerId, cardId) {
  try {
    const { data, error } = await supabase.from("cloud_commands").select("id").eq("target_device", `worker:${workerId}`).eq("card_id", cardId).in("kind", INSTRUCTIONS).order("created_at", { ascending: false }).limit(1).maybeSingle();
    return error || !data?.id ? null : String(data.id);
  } catch {
    return null;
  }
}

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
  // The folder too: the same command in another folder of the checkout runs other code.
  const keyOf = (worker, pin, card, ref, a, names, instruction) => [worker.id, sha(pin.publicKey), card, ref.id, sha(a.command), sha(a.script), sha(a.cwd), sha([...names].sort().join(",")), instruction].join("\n");

  // Whether the user allowed it: a live standing grant, else the worker window (pinning a first-seen key on a yes).
  async function allowed(ctx, names) {
    const { account, row, worker, a, pin, signKey, ref } = ctx;
    const instruction = await latestInstruction(account.supabase, worker.id, row.card_id);
    const key = instruction ? keyOf(worker, pin, row.card_id, ref, a, names, instruction) : null;
    // Never for a key that isn't pinned yet (re-pinned, or first seen): the Allow below pins it first.
    if (key && !pin.firstUse && pin.signKey && (grants.get(key) ?? 0) > now()) return "grant";
    const request = describe({ kind: "dev", command: a.command, cwd: a.cwd, script: a.script, names, environment: "development", label: ref.label, thread: a.thread, why: a.why, worker: worker.name, remote: a.remote, fingerprint: pin.fingerprint, firstUse: pin.firstUse });
    if (!(await ask(request))) return null;
    if (now() > a.expiresAt) throw new Error("The ask expired while it waited for you. Start the dev server again.");
    if (pin.firstUse || !pin.signKey) pins.pin(worker.id, { name: worker.name, publicKey: pin.publicKey, signKey });
    if (key) grants.set(key, now() + GRANT_MS);
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
