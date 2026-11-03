// Main's side of a Weft Worker card's Goose key (docs/architecture/weft-worker.md#goose-on-a-worker). The provider's key
// lives in this Mac's Keychain (electron/goose-token.cjs); a Goose turn on a paired worker whose provider takes one asks
// for it with a signed `goose_key` device call, and the board's server passes main only the call's id.
//
// Main believes none of the row: it re-reads it with its own session (electron/worker-ask-row.cjs), requires the sign
// key it pinned at pairing and the worker's signature over the card, the box key, the nonce, the expiry, the provider and
// the endpoint, holds the card to one its owner started (cardOrigin) and the nonce to one use (nonces). Then it refuses
// unless the provider and endpoint are exactly what this Mac last set for that worker with Touch ID
// (electron/worker-goose-set.cjs), so the key can only go where the user already pointed that worker's Goose. It asks
// Touch ID again, naming the worker, the card, the provider and the endpoint, seals the key to the pinned box key for
// this card, ask, provider and endpoint, and queues it as a Mac-signed `secret_use` marked `use: "goose"`.
const { capped, expiryOf, plain, MAX_THREAD } = require("./worker-ask.cjs");
const { queueSecretUse, readWorkerAsk, signKeyOf, signedIn, verifySigned } = require("./worker-ask-row.cjs");
const { seal } = require("./worker-seal.cjs");
const { providerById } = require("./goose-provider.cjs");
const { GOOSE_KEY, GOOSE_KEY_ENVIRONMENT, gooseKeyAskMessage, gooseKeyCommand, gooseKeyPurpose } = require("./worker-goose-key-wire.cjs");

const TOOLS = new Set([GOOSE_KEY]);
const NONCE = /^[0-9a-f]{64}$/;
// lib/host-goose-settings.ts caps the endpoint the same.
const URL_MAX = 500;
const BAD = "That Goose key ask isn't one Weft makes.";

/**
 * The ask's fields, each checked: a provider in the catalog that takes a key, an endpoint that's "" or plain text.
 * @param {unknown} raw @param {number} now
 */
function gooseKeyAskOf(raw, now) {
  const a = /** @type {Record<string, unknown>} */ (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {});
  const nonce = typeof a.nonce === "string" && NONCE.test(a.nonce) ? a.nonce : null;
  const provider = typeof a.providerId === "string" ? providerById(a.providerId) : null;
  if (!nonce || !provider || provider.id === "ollama" || typeof a.baseUrl !== "string") throw new Error(BAD);
  const baseUrl = a.baseUrl === "" ? "" : plain(a.baseUrl, URL_MAX, "endpoint");
  if (baseUrl === undefined) throw new Error(BAD);
  return { nonce, expiresAt: expiryOf(a.expiresAt, now), provider, baseUrl, thread: capped(a.thread, MAX_THREAD), sig: typeof a.sig === "string" ? a.sig : undefined };
}

/** The Touch ID reason: the worker, the card, the provider and where its key goes. */
function gooseKeyReason({ worker, provider, baseUrl, saved, card, firstKey = "" }) {
  const where = baseUrl ? `the endpoint ${baseUrl}` : `${provider.label}'s own endpoint`;
  const differs = baseUrl && saved && saved !== baseUrl ? ` (the key was saved for ${saved})` : "";
  const key = firstKey ? ` Its box key ${firstKey} is new to this Mac and gets pinned.` : "";
  return `send your ${provider.label} key to the worker ${worker} for one Goose turn${card ? ` of "${card}"` : ""}, to ${where}${differs}. Any code that turn runs there can read it.${key}`;
}

/**
 * @param {{
 *   accountClient: () => any,
 *   pins: { lookup: (worker: { id: string, name: string, publicKey: string }) => { publicKey: string, fingerprint: string, firstUse: boolean, signKey?: string }, pin: (id: string, keys: { name: string, publicKey: string }) => void },
 *   signer: () => Promise<{ publicKey: () => string, sign: (message: string) => string }>,
 *   confirm: (reason: string) => Promise<boolean>,
 *   readKey: (providerId: string) => { token: string, baseUrl?: string } | null,
 *   lastSet: { of: (worker: string) => { providerId: string, baseUrl: string } | null },
 *   nonces: { take: (nonce: string, expiresAt: number) => void },
 *   cardOrigin: (supabase: any, uid: string, workerId: string, cardId: string, folder: string) => Promise<void>,
 *   audit?: (entry: Record<string, unknown>) => unknown,
 *   now?: () => number,
 * }} deps
 */
function createWorkerGooseKey({ accountClient, pins, signer, confirm, readKey, lastSet, nonces, cardOrigin, audit = (entry) => entry, now = Date.now }) {
  async function answer(callId) {
    const { account, uid } = signedIn(accountClient);
    const { row, worker, folder, title } = await readWorkerAsk(account.supabase, uid, callId, TOOLS);
    const a = gooseKeyAskOf(row.args, now());
    const pin = pins.lookup({ id: worker.id, name: worker.name, publicKey: worker.public_key });
    // Only a paired worker's: its sign key was pinned under the pairing's Touch ID, never taken off the row here.
    if (!pin.signKey) throw new Error(`${worker.name} has no pinned signing key on this Mac, so its Goose can't have your key. Pair it from Settings → Devices → Add a worker.`);
    verifySigned(signKeyOf(pin, worker), gooseKeyAskMessage(row.card_id, pin.publicKey, { ...a, providerId: a.provider.id }), a.sig);
    await cardOrigin(account.supabase, uid, worker.id, row.card_id, folder);
    nonces.take(a.nonce, a.expiresAt);
    const set = lastSet.of(worker.id);
    if (!set || set.providerId !== a.provider.id || set.baseUrl !== a.baseUrl)
      throw new Error(`${worker.name} asked for your ${a.provider.label} key for an endpoint this Mac didn't set for it. Save its Goose provider and endpoint in Settings → Threads → On a worker, then try again.`);
    const record = readKey(a.provider.id);
    if (!record?.token) return { none: true, label: a.provider.label };
    const allowed = await confirm(gooseKeyReason({ worker: worker.name, provider: a.provider, baseUrl: a.baseUrl, saved: record.baseUrl, card: title || a.thread, firstKey: pin.firstUse ? pin.fingerprint : "" }));
    audit({ kind: "vault", action: "worker goose key", by: "thread", card: row.card_id, detail: `${a.provider.label} ${a.baseUrl || "(default endpoint)"}`, worker: worker.name, outcome: allowed ? "ok" : "denied" });
    if (!allowed) return { denied: true, label: a.provider.label };
    if (now() > a.expiresAt) throw new Error("The ask expired while it waited for you. The next Goose turn asks again.");
    // A box key seen first now (after a Re-pin) is pinned once the user allows, as a run's is (electron/worker-secret.cjs).
    if (pin.firstUse) pins.pin(worker.id, { name: worker.name, publicKey: pin.publicKey });
    const command = gooseKeyCommand(a.provider.id, a.baseUrl);
    const name = a.provider.envKey;
    const plaintext = JSON.stringify({ v: 1, card: row.card_id, nonce: a.nonce, command, names: [name], environment: GOOSE_KEY_ENVIRONMENT, expiresAt: a.expiresAt, values: { [name]: record.token } });
    // Sealed to the pinned box key, never the row's, and signed with this Mac's device key by queueSecretUse.
    await queueSecretUse(account.supabase, row, worker, signer, a.nonce, seal(pin.publicKey, plaintext, gooseKeyPurpose(row.card_id, a.nonce, command)), { use: "goose" });
    return { queued: true, label: a.provider.label };
  }

  // One Touch ID window at a time.
  let line = Promise.resolve();
  return {
    /** @param {string} callId @returns {Promise<{ queued?: true, denied?: true, none?: true, label: string }>} */
    answer(callId) {
      const turn = line.then(() => answer(callId));
      line = turn.then(
        () => {},
        () => {},
      );
      return turn;
    },
  };
}

module.exports = { createWorkerGooseKey, gooseKeyAskOf, gooseKeyReason };
