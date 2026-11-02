// Main's side of a Weft Worker's secret run (docs/architecture/project-hosts.md#secrets-on-a-worker-h8-the-per-use-seal-as-built).
// A worker card's mcp__secrets__run reaches this Mac as a `secret_run` device call; the board's server claims it and
// passes only its id. Main believes none of that: it re-reads the row through its own session, checks the ask
// (electron/worker-ask.cjs), holds the worker's key to the one it pinned (electron/worker-pins.cjs), finds the vault
// the card's own project names, and asks the user with Touch ID in a window that says it's for a worker. On a yes it
// seals the values to the pinned key for this card, ask and command (electron/worker-seal.cjs) and queues the
// `secret_use` command. The values leave main only sealed. Asks are taken one at a time, at most one per card.
const crypto = require("node:crypto");
const { askOf, vaultFor } = require("./worker-ask.cjs");
const { seal, secretUseMessage, secretUsePurpose } = require("./worker-seal.cjs");

// The message a paired worker signs for an ask (lib/secret-use.ts askMessage is the same, checked by a test).
const askMessage = (cardId, a) => JSON.stringify(["weft-secret-ask", cardId, a.nonce, a.command, a.names, a.environment, a.remote, a.cwd, a.script ?? null, a.expiresAt]);

/**
 * Whether the ask came from the worker itself: signed by its Ed25519 sign key from pairing (H10, pinned at pairing by
 * electron/host-pairing.cjs) over askMessage, which lib/worker-secret-wiring.ts signs from sign-key.json. Always
 * required: an unsigned or wrongly signed ask is refused.
 * @param {string} signKey DER SPKI, base64 @param {string} cardId @param {ReturnType<typeof askOf>} a
 */
function verifyAsk(signKey, cardId, a) {
  let ok = false;
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(signKey, "base64"), format: "der", type: "spki" });
    ok = Boolean(a.sig) && crypto.verify(null, Buffer.from(askMessage(cardId, a)), key, Buffer.from(String(a.sig), "base64"));
  } catch {
    ok = false;
  }
  if (!ok) throw new Error("That ask isn't signed by the worker's pinned key.");
}

// The sign key a worker's asks must be signed with: the pinned one, else the row's (H10 sets it at pairing; it's then
// pinned with the Allow). Sticky: a pinned sign key that the row no longer shows, or shows changed, is refused. A worker
// with none was enrolled by token: it can't check this Mac's signature on a secret_use either, so it gets no secrets.
/** @param {{ signKey?: string }} pin @param {{ name: string, sign_key?: string | null }} worker @returns {string} */
function signKeyOf(pin, worker) {
  if (pin.signKey && pin.signKey !== worker.sign_key) throw new Error(`${worker.name}'s signing key changed since this Mac pinned it, so it gets no secrets. Pair it again from Settings → Devices.`);
  const key = pin.signKey ?? worker.sign_key;
  if (!key) throw new Error(`${worker.name} was enrolled by token, so it can't take secrets. Pair it from Settings → Devices → Add a worker, then try again.`);
  return key;
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
 *   now?: () => number,
 * }} deps
 */
function createWorkerSecrets({ vault, ask, describe, accountClient, pins, signer, projectRepos, audit = (entry) => entry, now = Date.now }) {
  async function read(supabase, uid, callId) {
    const { data: row } = await supabase.from("device_calls").select("id, org_id, owner_user, worker_id, card_id, tool, args, status").eq("id", String(callId)).maybeSingle();
    if (!row || row.tool !== "secret_run" || row.owner_user !== uid) throw new Error("That request isn't from one of your workers.");
    if (row.status !== "claimed") throw new Error("That request was already answered.");
    const { data: worker } = await supabase.from("cloud_workers").select("id, name, owner_user, public_key, sign_key").eq("id", row.worker_id).maybeSingle();
    if (!worker || worker.owner_user !== uid) throw new Error("That worker isn't yours.");
    if (!worker.public_key) throw new Error(`${worker.name} hasn't published its key yet. Update it (weft-worker update), then try again.`);
    const { data: card } = await supabase.from("cloud_cards").select("folder").eq("card_id", row.card_id).eq("owner_worker", row.worker_id).maybeSingle();
    if (!card?.folder) throw new Error("That card isn't on that worker.");
    return { row, worker, folder: String(card.folder) };
  }

  async function answer(account, uid, callId) {
    const { row, worker, folder } = await read(account.supabase, uid, callId);
    const a = askOf(row.args, now());
    // Read only: a first-seen key is pinned after the user allows, never on a Deny or an error.
    const pin = pins.lookup({ id: worker.id, name: worker.name, publicKey: worker.public_key });
    const signKey = signKeyOf(pin, worker);
    verifyAsk(signKey, row.card_id, a);
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
    const plaintext = JSON.stringify({ v: 1, card: row.card_id, nonce: a.nonce, command: a.command, names: a.names, environment: a.environment, expiresAt: a.expiresAt, values });
    // Sealed to the pinned key, never straight from the row.
    const sealed = seal(pin.publicKey, plaintext, secretUsePurpose(row.card_id, a.nonce, a.command));
    // Signed with this Mac's device key, so the worker can tell this row from one sealed by anyone with its public key.
    const key = await signer();
    const mac = { key: key.publicKey(), sig: key.sign(secretUseMessage(row.card_id, a.nonce, sealed)) };
    const command = { org_id: row.org_id, kind: "secret_use", target_device: `worker:${worker.id}`, folder: "-", payload: { cardId: row.card_id, nonce: a.nonce, sealed, mac } };
    const { error } = await account.supabase.from("cloud_commands").insert(command);
    if (error) throw new Error(`Couldn't send the secrets to ${worker.name}: ${error.message}`);
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
