// Main's side of a Weft Worker card's vault calls (docs/architecture/project-hosts.md#the-vault-on-a-worker-t2-as-built):
// mcp__secrets__list, add_blank, ask_add, set_value, push_to_vercel and a dev server's env. The board's server claims the
// device call and passes only its id (POST /secrets/worker-vault). Main believes none of it: it re-reads the row with
// its own session, checks the fields for that tool (electron/worker-vault-ask.cjs), requires the worker's pinned sign
// key and its signature over everything it acts on, and uses the vault the card's own project names on this Mac
// (electron/worker-ask.cjs vaultFor, through this Mac's own clone of it). Answers carry names, never a value; a write
// asks Touch ID in words that name the worker; set_value's value arrives sealed to this Mac's key.
const crypto = require("node:crypto");
const { vaultFor } = require("./worker-ask.cjs");
const { readWorkerAsk, signKeyOf, signedIn, verifySigned } = require("./worker-ask-row.cjs");
const { vaultAskOf } = require("./worker-vault-ask.cjs");
const { DEV_ENV, VAULT_BLANK, VAULT_LIST, VAULT_PUSH, VAULT_SET, VAULT_TOOLS, vaultAskMessage } = require("./worker-vault-wire.cjs");
const { fillBlank } = require("./vault-routes.cjs");

// set_value's sealed value, opened and held to the row: the same card, ask, name and environment, or nothing.
/** @param {string} text @param {{ card_id: string }} row @param {{ nonce: string, name?: unknown, environment?: unknown }} a @returns {string} */
function openedValue(text, row, a) {
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    v = null;
  }
  const same = v && v.v === 1 && v.card === row.card_id && v.nonce === a.nonce && v.name === a.name && v.environment === a.environment;
  if (!same || typeof v.value !== "string" || !v.value) throw new Error("That value wasn't sealed for this ask.");
  return v.value;
}

/**
 * @param {{
 *   vault: any,
 *   vercelEnv: () => { push: (folder: string, name: string, environment: string, card: string, who: string) => Promise<Record<string, unknown>> } | null | undefined,
 *   accountClient: () => any,
 *   pins: { lookup: (worker: { id: string, name: string, publicKey: string }) => { publicKey: string, fingerprint: string, firstUse: boolean, signKey?: string } },
 *   signer: () => Promise<{ openBox: (sealed: string) => string }>,
 *   projectFolders: (folder: string) => Promise<{ path: string, id: string }[]>,
 *   devEnv: { answer: (ctx: Record<string, any>) => Promise<unknown> },
 *   cardFolder?: (workerId: string, cardId: string, folder: string) => void,
 *   audit?: (entry: Record<string, unknown>) => unknown,
 *   now?: () => number,
 * }} deps
 */
function createWorkerVault({ vault, vercelEnv, accountClient, pins, signer, projectFolders, devEnv, cardFolder = () => {}, audit = (entry) => entry, now = Date.now }) {
  // Nonces answered, until their ask expires: a signed ask copied into a new row (anyone with the worker's wwk_ key can
  // make one) is answered once, never again.
  /** @type {Map<string, number>} */
  const answered = new Map();
  function once(a) {
    for (const [n, until] of answered) if (until < now()) answered.delete(n);
    if (answered.has(a.nonce)) throw new Error("That ask was already answered.");
    answered.set(a.nonce, a.expiresAt);
  }

  async function context(callId) {
    const { account, uid } = signedIn(accountClient);
    const { row, worker, folder, title } = await readWorkerAsk(account.supabase, uid, callId, VAULT_TOOLS);
    const a = vaultAskOf(row.tool, row.args, now());
    const pin = pins.lookup({ id: worker.id, name: worker.name, publicKey: worker.public_key });
    // Only a paired worker's: its sign key was pinned under the pairing's Touch ID, never taken off the row here.
    if (!pin.signKey) throw new Error(`${worker.name} has no pinned signing key on this Mac, so its cards can't reach the vault. Pair it from Settings → Devices → Add a worker.`);
    const signKey = signKeyOf(pin, worker);
    verifySigned(signKey, vaultAskMessage(row.card_id, pin.publicKey, row.tool, a), a.sig);
    once(a);
    cardFolder(worker.id, row.card_id, folder);
    const matches = await projectFolders(folder);
    const ref = vaultFor(a.remote, folder, matches.map((m) => m.id));
    const local = /** @type {{ path: string }} */ (matches.find((m) => m.id === ref.id)).path;
    return { account, row, worker, a, pin, signKey, ref, local, who: `on the worker ${worker.name}${title ? ` (card "${title}")` : ""}` };
  }

  const ops = {
    [VAULT_LIST]: async ({ local }) => {
      const { label, secrets } = await vault.names(local);
      return { label, secrets: (secrets ?? []).map((s) => ({ name: s.name, environment: s.environment, missing: Boolean(s.missing) })) };
    },
    [VAULT_BLANK]: async ({ local, a, who }) => {
      const r = await vault.addBlanks(local, a.names, [a.environment], { source: `a thread ${who}`, hint: a.hint });
      return { label: r?.label, filled: Array.isArray(r?.filled) ? r.filled : [] };
    },
    [VAULT_SET]: async ({ local, a, row, who }) => {
      const value = openedValue(await openSealed(a.sealed), row, a);
      // A short fingerprint of the value, so the prompt can be matched to what the thread made.
      const print = crypto.createHash("sha256").update(value, "utf8").digest("hex").slice(0, 8);
      return fillBlank(vault, local, a.name, a.environment, value, a.replace, "", who, `value sha256 ${print}…`);
    },
    [VAULT_PUSH]: ({ local, a, who }) => {
      const env = vercelEnv();
      if (!env) throw new Error("Vercel isn't set up in Weft on this Mac yet.");
      return env.push(local, a.name, a.environment, "", who);
    },
    [DEV_ENV]: (ctx) => devEnv.answer(ctx),
  };

  async function openSealed(sealed) {
    try {
      return (await signer()).openBox(sealed);
    } catch {
      throw new Error("That value wasn't sealed to this Mac. The worker may be paired with another Mac.");
    }
  }

  return {
    /** @param {string} callId */
    async answer(callId) {
      const ctx = await context(callId);
      const { row, worker, a, ref } = ctx;
      const result = await ops[row.tool](ctx);
      if (row.tool !== DEV_ENV) audit({ kind: "vault", action: `worker ${row.tool.replace("vault_", "")}`, by: "thread", card: row.card_id, names: a.names ?? (a.name ? [a.name] : undefined), environment: a.environment, vault: ref.label, worker: worker.name });
      return result;
    },
  };
}

module.exports = { createWorkerVault, openedValue };
