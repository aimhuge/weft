// A worker's connector grants, made in main (docs/architecture/connectors.md#who-may-say-yes-the-chain-of-trust).
// Settings → Devices → a worker → Connectors turns GitHub on, changes its settings, allows a project or card and vouches
// for another Mac, over the board-only IPC handler (electron/pairing-ipc.cjs): never a thread or the control server.
// Each takes Touch ID first, in words that name the worker and what changes, and then this Mac's approval key
// (electron/desktop-signer.cjs, sealed in ~/.weft/vault where threads can't read it) signs exactly what weft.zip will
// write (electron/connector-sign.cjs). weft.zip checks the signature, and its mint checks it again, so the account's
// session alone (stolen, or a thread's) can't turn anything on. The worker is vouched for from this Mac's own pin of the
// keys it checked at pairing (electron/worker-pins.cjs), never the row a session can change. Turning a connector off
// goes through weft.zip's revoke route instead (lib/connector-remote.ts), which also ends the tokens at GitHub.
//
// SCOPES, APPROVALS, LIFETIMES, ASKS and looser are lib/connector-grant.ts's, held to it by electron/connector-grants.test.ts.
const crypto = require("node:crypto");
const os = require("node:os");
const { allowMessage, endorseMessage, grantMessage, signerMessage, workerMessage } = require("./connector-sign.cjs");

const SCOPES = ["installed", "project", "card"];
const APPROVALS = ["worker", "project", "card"];
const LIFETIMES = ["revoked", "24h", "8h"];
const ASKS = ["protected_push"];
const LIFETIME_MS = { revoked: Infinity, "24h": 24 * 3_600_000, "8h": 8 * 3_600_000 };
const DEFAULTS = { scope: "project", approval: "worker", lifetime: "revoked", asks: ["protected_push"] };
const CONNECTOR_NAMES = { github: "GitHub as you, with Weft" };
const SHORT_NAMES = { github: "GitHub" };
const REGISTERED_MS = 10 * 60_000;

const pick = (list, v, d) => (list.includes(v) ? v : d);

/** @param {any} raw */
function settingsOf(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const asks = Array.isArray(r.asks) ? r.asks.filter((a) => ASKS.includes(a)) : DEFAULTS.asks;
  return { scope: pick(SCOPES, r.scope, DEFAULTS.scope), approval: pick(APPROVALS, r.approval, DEFAULTS.approval), lifetime: pick(LIFETIMES, r.lifetime, DEFAULTS.lifetime), asks: [...new Set(asks)] };
}

function looser(was, next) {
  return (
    SCOPES.indexOf(next.scope) < SCOPES.indexOf(was.scope) ||
    APPROVALS.indexOf(next.approval) < APPROVALS.indexOf(was.approval) ||
    LIFETIME_MS[next.lifetime] > LIFETIME_MS[was.lifetime] ||
    was.asks.some((a) => !next.asks.includes(a))
  );
}

const clean = (s, max) => String(s ?? "").replace(/[^\x20-\x7e]/g, "?").slice(0, max);
const fingerprint = (key) => crypto.createHash("sha256").update(String(key)).digest("hex").slice(0, 16).replace(/(.{4})(?!$)/g, "$1 ");

// What the Touch ID prompt says for a change: turning on, giving cards more, or making it stricter.
function changeReason(was, next, name, connector) {
  if (!was) return `let the worker ${name} use ${CONNECTOR_NAMES[connector]}, for cards you start on it`;
  const what = `${next.scope} repos, approval ${next.approval}, lifetime ${next.lifetime}`;
  if (looser(settingsOf(was), next)) return `give cards on the worker ${name} more ${SHORT_NAMES[connector]} access (${what})`;
  return `make ${SHORT_NAMES[connector]} on the worker ${name} stricter (${what})`;
}

/**
 * @param {{ db: () => any, fetch?: typeof fetch, site?: string }} deps
 * @returns {(method: string, path: string, body?: unknown) => Promise<any>} a call to weft.zip's connector routes with this account's session
 */
function weftZip({ db, fetch: fetchImpl = globalThis.fetch, site = "https://weft.zip" }) {
  return async (method, path, body) => {
    const token = (await db().auth.getSession())?.data?.session?.access_token;
    if (!token) throw new Error("Sign in to Weft first.");
    let res;
    try {
      res = await fetchImpl(`${site.replace(/\/+$/, "")}/api/connectors${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch {
      throw new Error("Couldn't reach weft.zip.");
    }
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) throw new Error(json?.error || `weft.zip answered HTTP ${res.status}.`);
    return json;
  };
}

/**
 * This Mac's side of the chain of trust: its key registered as a signer, a worker vouched for from its local pin.
 * @param {{ db: () => any, userId: () => string | null, sign: (message: string) => Promise<string>, signKey: () => Promise<string>,
 *   pins: { pinned: (id: string) => { publicKey?: string, signKey?: string } | null }, call: ReturnType<typeof weftZip>,
 *   macName?: () => string, device?: () => string, now?: () => number }} deps
 */
function createConnectorSigner({ userId, sign, signKey, pins, call, macName = () => os.hostname(), device = () => "", now = Date.now }) {
  // Registered lately for this account: skip weft.zip for 10 minutes (Settings → Devices asks on every open).
  let lately = null;
  async function register() {
    const uid = userId();
    if (!uid) throw new Error("Sign in to Weft first.");
    const key = await signKey();
    if (lately && lately.uid === uid && lately.key === key && now() - lately.at < REGISTERED_MS) return { uid, key, signer: lately.signer };
    const name = clean(macName(), 80) || "A Mac";
    const issuedAt = now();
    const sig = await sign(signerMessage({ userId: uid, key, name, issuedAt }));
    const { signer } = await call("POST", "/signers", { key, name, device: clean(device(), 100), issuedAt, sig });
    lately = { uid, key, signer, at: now() };
    return { uid, key, signer };
  }

  // Vouches for a worker this Mac paired: the keys it pinned then, signed.
  async function vouch(workerId) {
    const pin = pins.pinned(String(workerId));
    if (!pin?.signKey || !pin.publicKey) throw new Error("This Mac didn't pair that worker, so it can't vouch for it. Turn GitHub on from the Mac that paired it, or pair it again here.");
    const { uid, key } = await register();
    const sig = await sign(workerMessage({ userId: uid, workerId: String(workerId), signKey: pin.signKey, boxKey: pin.publicKey }));
    return call("POST", "/pin", { workerId: String(workerId), signKey: pin.signKey, boxKey: pin.publicKey, signerKey: key, sig });
  }

  return { register, vouch, forget: () => void (lately = null) };
}

/**
 * @param {(channel: string, fn: (...args: any[]) => unknown) => void} handle the board-only IPC handler
 * @param {Parameters<typeof createConnectorSigner>[0] & { confirm: (reason: string) => Promise<boolean> }} deps
 */
function registerConnectorGrants(handle, deps) {
  const { db, userId, confirm, sign, call, now = Date.now } = deps;
  const signer = createConnectorSigner(deps);
  const nonce = () => crypto.randomBytes(32).toString("hex");

  // Turns a connector on for a worker, or changes its settings. { denied: true } when Touch ID said no.
  handle("connectors:set", async (workerId, workerName, connector, rawSettings) => {
    const uid = userId();
    if (!uid) throw new Error("Sign in to Weft first.");
    if (!CONNECTOR_NAMES[connector]) throw new Error("Weft doesn't know that connector.");
    const worker = String(workerId);
    const next = settingsOf(rawSettings);
    const { data: was, error } = await db().from("connector_grants").select("scope, approval, lifetime, asks, epoch").eq("user_id", uid).eq("worker_id", worker).eq("connector", connector).maybeSingle();
    if (error) throw new Error(`Couldn't read the grant: ${error.message}`);
    if (!(await confirm(changeReason(was, next, clean(workerName || worker, 60), connector)))) return { denied: true };
    const { key } = await signer.register();
    await signer.vouch(worker);
    const statement = { userId: uid, workerId: worker, connector, settings: next, nonce: nonce(), issuedAt: now(), prevEpoch: Number(was?.epoch ?? 0) };
    const sig = await sign(grantMessage(statement));
    const r = await call("POST", "/github/grant", { workerId: worker, connector, settings: next, nonce: statement.nonce, issuedAt: statement.issuedAt, prevEpoch: statement.prevEpoch, signerKey: key, sig });
    return { ok: true, settings: next, waitingUntil: r.waitingUntil ?? null };
  });

  // Allows one project or card under a per-project or per-card approval, after Touch ID.
  handle("connectors:allow", async (grantId, workerName, kind, subject, label) => {
    if (kind !== "project" && kind !== "card") throw new Error("Allow a project or a card.");
    const uid = userId();
    if (!uid) throw new Error("Sign in to Weft first.");
    const what = kind === "project" ? `the project ${clean(subject, 120)}` : `the card "${clean(label || subject, 80)}"`;
    if (!(await confirm(`let ${what} on the worker ${clean(workerName, 60)} use GitHub as you`))) return { denied: true };
    const { key } = await signer.register();
    const statement = { userId: uid, grantId: String(grantId), kind, subject: String(subject).slice(0, 201), nonce: nonce(), issuedAt: now() };
    const sig = await sign(allowMessage(statement));
    await call("POST", "/github/allow", { ...statement, signerKey: key, sig });
    return { ok: true };
  });

  // This Mac's key, registered if it wasn't (no Touch ID: it's this Mac's own key, and a new one only waits), and
  // every Mac key of yours with whether it's trusted yet.
  handle("connectors:signers", async () => {
    const { key } = await signer.register();
    const { signers } = await call("GET", "/signers");
    return { mine: key, signers };
  });

  // Vouches for another Mac's key, so it's trusted now instead of after its day. Touch ID names it and its fingerprint.
  handle("connectors:trust", async (key, name) => {
    const uid = userId();
    if (!uid) throw new Error("Sign in to Weft first.");
    if (!(await confirm(`trust the Mac "${clean(name, 60)}" (key ${fingerprint(key)}) to approve connectors for you. Only if you just set that Mac up`))) return { denied: true };
    const { key: by } = await signer.register();
    const issuedAt = now();
    const sig = await sign(endorseMessage({ userId: uid, key: String(key), by, issuedAt }));
    await call("POST", "/signers/endorse", { key: String(key), by, issuedAt, sig });
    return { ok: true };
  });

  // Takes a Mac key's trust away (a reduction, so no Touch ID): the grants it signed go, with their tokens.
  handle("connectors:forget-signer", async (id) => {
    signer.forget();
    return call("DELETE", `/signers?id=${encodeURIComponent(String(id))}`);
  });

  return signer;
}

module.exports = { registerConnectorGrants, createConnectorSigner, weftZip, settingsOf, looser, fingerprint, SCOPES, APPROVALS, LIFETIMES, ASKS };
