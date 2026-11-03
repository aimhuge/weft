// Main's side of a Weft Worker's secret run (docs/architecture/project-hosts.md#secrets-on-a-worker-h8-the-per-use-seal-as-built).
// A worker card's mcp__secrets__run reaches this Mac as a `secret_run` device call; the board's server claims it and
// passes only its id. Main believes none of that: it re-reads the row through its own session, checks the ask
// (electron/worker-ask.cjs), holds the worker's key to the one it pinned (electron/worker-pins.cjs), finds the vault
// the card's own project names, and asks the user with Touch ID in a window that says it's for a worker. On a yes it
// seals the values to the pinned key for this card, ask and command (electron/worker-seal.cjs) and queues the
// `secret_use` command. The values leave main only sealed. Asks are taken one at a time, at most one per card.
const { askOf, vaultFor } = require("./worker-ask.cjs");
const { queueSecretUse, readWorkerAsk, signKeyOf, verifySigned } = require("./worker-ask-row.cjs");
const { seal, secretUsePurpose } = require("./worker-seal.cjs");
const { splitKept, withKept } = require("./worker-kept.cjs");

const TOOLS = new Set(["secret_run"]);

// The message a paired worker signs for an ask (lib/secret-use.ts askMessage is the same, checked by a test).
// boxKey is the worker's seal key, so the signature covers the key main seals to, after a Re-pin too.
const askMessage = (cardId, boxKey, a) => JSON.stringify(["weft-secret-ask-v2", cardId, boxKey, a.nonce, a.command, a.names, a.environment, a.remote, a.cwd, a.script ?? null, a.expiresAt]);

/**
 * Whether the ask came from the worker itself: signed by its Ed25519 sign key from pairing (H10, pinned at pairing by
 * electron/host-pairing.cjs) over askMessage, which lib/worker-secret-wiring.ts signs from sign-key.json. Always
 * required: an unsigned or wrongly signed ask is refused.
 * @param {string} signKey DER SPKI, base64 @param {string} cardId @param {string} boxKey the key main will seal to
 * @param {ReturnType<typeof askOf>} a
 */
function verifyAsk(signKey, cardId, boxKey, a) {
  verifySigned(signKey, askMessage(cardId, boxKey, a), a.sig);
}

/**
 * @param {{
 *   vault: { valuesForVault: (ref: { id: string, label: string }, names: string[], environment: string, use: false) => Promise<{ values: Record<string, string>, missing: string[] }> },
 *   ask: (request: { message: string, detail: string, reason: string, view: Record<string, unknown> }) => Promise<string | null>,
 *   describe: typeof import("./secret-run.cjs").describe,
 *   accountClient: () => { supabase: any, getClaims: () => Record<string, unknown> | null } | null | undefined,
 *   pins: { lookup: (worker: { id: string, name: string, publicKey: string }) => { publicKey: string, fingerprint: string, firstUse: boolean, signKey?: string }, pin: (id: string, keys: { name: string, publicKey: string, signKey?: string }) => void },
 *   signer: () => Promise<{ publicKey: () => string, sign: (message: string) => string }>,
 *   projectRepos: (folder: string) => Promise<string[]>,
 *   audit?: (entry: Record<string, unknown>) => unknown,
 *   kept?: ReturnType<typeof import("./worker-kept.cjs").createKeptRecord>,
 *   now?: () => number,
 * }} deps
 */
function createWorkerSecrets({ vault, ask, describe, accountClient, pins, signer, projectRepos, audit = (entry) => entry, kept, now = Date.now }) {
  async function answer(account, uid, callId) {
    const { row, worker, folder } = await readWorkerAsk(account.supabase, uid, callId, TOOLS);
    const a = askOf(row.args, now());
    // Read only: a first-seen key is pinned after the user allows, never on a Deny or an error.
    const pin = pins.lookup({ id: worker.id, name: worker.name, publicKey: worker.public_key });
    const signKey = signKeyOf(pin, worker);
    verifyAsk(signKey, row.card_id, pin.publicKey, a);
    const ref = vaultFor(a.remote, folder, await projectRepos(folder));
    const { values, missing } = await vault.valuesForVault(ref, a.names, a.environment, false);
    if (missing.length) return { missing, label: ref.label };
    const request = describe({ kind: "run", command: a.command, cwd: a.cwd, script: a.script, names: a.names, environment: a.environment, label: ref.label, thread: a.thread, why: a.why, worker: worker.name, remote: a.remote, fingerprint: pin.fingerprint, firstUse: pin.firstUse });
    // Once only, whatever was clicked: a worker's command and script are its word, not this disk's, so no Always rule.
    const allowed = Boolean(await ask(request));
    audit({ kind: "vault", action: "worker run", by: "thread", card: row.card_id, thread: a.thread, detail: a.why, command: a.command, names: a.names, environment: a.environment, vault: ref.label, worker: worker.name, via: allowed ? "once" : undefined, outcome: allowed ? "ok" : "denied" });
    if (!allowed) return { denied: true, label: ref.label };
    if (now() > a.expiresAt) throw new Error("The ask expired while it waited for you. The thread can ask again.");
    if (pin.firstUse || !pin.signKey) pins.pin(worker.id, { name: worker.name, publicKey: pin.publicKey, signKey });
    // A value this Mac kept on the worker, unchanged since, isn't carried again: the sealed answer names its version and
    // the worker opens its own copy (electron/worker-kept.cjs). The approval above is the same either way.
    const split = kept ? splitKept(kept, worker.id, ref.id, a.environment, values, row.args?.kept) : { values, kept: {} };
    const plaintext = JSON.stringify(withKept({ v: 1, card: row.card_id, nonce: a.nonce, command: a.command, names: a.names, environment: a.environment, expiresAt: a.expiresAt }, split));
    // Sealed to the pinned key, never straight from the row.
    const sealed = seal(pin.publicKey, plaintext, secretUsePurpose(row.card_id, a.nonce, a.command));
    // Signed with this Mac's device key, so the worker can tell this row from one sealed by anyone with its public key.
    await queueSecretUse(account.supabase, row, worker, signer, a.nonce, sealed);
    return { queued: true, label: ref.label };
  }

  // One window at a time, and one ask per card waiting or open: a thread can't stack approvals on the user.
  let line = Promise.resolve();
  const waiting = new Set();

  return {
    /** @param {string} callId @returns {Promise<{ queued?: true, denied?: true, missing?: string[], label: string }>} */
    async answer(callId) {
      const account = accountClient();
      const uid = account?.getClaims()?.sub;
      if (!account || typeof uid !== "string") throw new Error("Sign in to Weft on this Mac to approve a worker's secrets.");
      const { data: peek } = await account.supabase.from("device_calls").select("card_id").eq("id", String(callId)).maybeSingle();
      const card = String(peek?.card_id ?? callId);
      if (waiting.has(card)) throw new Error("That card already has a secret ask waiting on this Mac. Wait for it to be answered.");
      waiting.add(card);
      const turn = line.then(() => answer(account, uid, callId));
      line = turn.then(
        () => {},
        () => {},
      );
      try {
        return await turn;
      } finally {
        waiting.delete(card);
      }
    },
  };
}

module.exports = { createWorkerSecrets, verifyAsk, askMessage };
