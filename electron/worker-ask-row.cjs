// What every Weft Worker ask to this Mac shares on main's side (docs/architecture/project-hosts.md, H8 and T2): the
// device_calls row read back through main's own Supabase session (never the server's or the caller's word), the
// worker's keys as this Mac pinned them, the check that the ask is signed by the worker's pinned sign key, and the
// sealed, Mac-signed `secret_use` command that carries values back. electron/worker-secret.cjs (a run) and
// electron/worker-vault.cjs (list, blanks, set_value, push_to_vercel, a dev server's env) both read through here.
const crypto = require("node:crypto");
const { secretUseMessage } = require("./worker-seal.cjs");

/**
 * The row, the worker and the card's folder, each read with the signed-in owner's session.
 * @param {any} supabase @param {string} uid @param {string} callId @param {ReadonlySet<string>} tools the tools this reader takes
 */
async function readWorkerAsk(supabase, uid, callId, tools) {
  const { data: row } = await supabase.from("device_calls").select("id, org_id, owner_user, worker_id, card_id, tool, args, status").eq("id", String(callId)).maybeSingle();
  if (!row || !tools.has(row.tool) || row.owner_user !== uid) throw new Error("That request isn't from one of your workers.");
  if (row.status !== "claimed") throw new Error("That request was already answered.");
  const { data: worker } = await supabase.from("cloud_workers").select("id, name, owner_user, public_key, sign_key, revoked_at").eq("id", row.worker_id).maybeSingle();
  if (!worker || worker.owner_user !== uid) throw new Error("That worker isn't yours.");
  // An ask made before a revoke and answered after it gets nothing (a dev grant would otherwise seal without asking).
  if (worker.revoked_at) throw new Error(`${worker.name} was revoked.`);
  if (!worker.public_key) throw new Error(`${worker.name} hasn't published its key yet. Update it (weft-worker update), then try again.`);
  const { data: card } = await supabase.from("cloud_cards").select("folder, title:card->>title").eq("card_id", row.card_id).eq("owner_worker", row.worker_id).maybeSingle();
  if (!card?.folder) throw new Error("That card isn't on that worker.");
  return { row, worker, folder: String(card.folder), title: shown(card.title) };
}

// The sign key a worker's asks must be signed with: the pinned one, else the row's (H10 sets it at pairing; it's then
// pinned with the Allow). Sticky: a pinned sign key that the row no longer shows, or shows changed, is refused. A worker
// with none was enrolled by token: it can't check this Mac's signature on a secret_use either, so it gets nothing.
/** @param {{ signKey?: string }} pin @param {{ name: string, sign_key?: string | null }} worker @returns {string} */
function signKeyOf(pin, worker) {
  if (pin.signKey && pin.signKey !== worker.sign_key) throw new Error(`${worker.name}'s signing key changed since this Mac pinned it, so it gets no secrets. Pair it again from Settings → Devices.`);
  const key = pin.signKey ?? worker.sign_key;
  if (!key) throw new Error(`${worker.name} was enrolled by token, so it can't take secrets. Pair it from Settings → Devices → Add a worker, then try again.`);
  return key;
}

/** Throws unless sig is the worker's Ed25519 signature (DER SPKI key, base64) over message. */
function verifySigned(signKey, message, sig) {
  let ok = false;
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(signKey, "base64"), format: "der", type: "spki" });
    ok = Boolean(sig) && crypto.verify(null, Buffer.from(message), key, Buffer.from(String(sig), "base64"));
  } catch {
    ok = false;
  }
  if (!ok) throw new Error("That ask isn't signed by the worker's pinned key.");
}

/**
 * Sealed values on their way to a worker: a `secret_use` command signed with this Mac's device key over the card, the
 * ask and the sealed bytes, so the worker can tell it from one sealed by anyone holding its public key.
 * @param {any} supabase @param {{ org_id: string, card_id: string }} row @param {{ id: string, name: string }} worker
 * @param {() => Promise<{ publicKey: () => string, sign: (message: string) => string }>} signer
 * @param {string} nonce @param {{ epk: string, iv: string, ct: string, tag: string }} sealed @param {Record<string, unknown>} [extra]
 */
async function queueSecretUse(supabase, row, worker, signer, nonce, sealed, extra = {}) {
  const key = await signer();
  const mac = { key: key.publicKey(), sig: key.sign(secretUseMessage(row.card_id, nonce, sealed)) };
  const command = { org_id: row.org_id, kind: "secret_use", target_device: `worker:${worker.id}`, folder: "-", payload: { cardId: row.card_id, nonce, sealed, mac, ...extra } };
  const { error } = await supabase.from("cloud_commands").insert(command);
  if (error) throw new Error(`Couldn't send the secrets to ${worker.name}: ${error.message}`);
}

// A card's title as the worker published it, made safe to show in a prompt: no control, format or bidi characters, short.
/** @param {unknown} v */
const shown = (v) => (typeof v === "string" ? v.replace(/[\p{C}]/gu, "").trim().slice(0, 80) : "");

/** The signed-in account in main, or a throw that says to sign in. */
function signedIn(accountClient) {
  const account = accountClient();
  const uid = account?.getClaims()?.sub;
  if (!account || typeof uid !== "string") throw new Error("Sign in to Weft on this Mac to answer a worker's asks.");
  return { account, uid };
}

module.exports = { readWorkerAsk, signKeyOf, verifySigned, queueSecretUse, signedIn };
