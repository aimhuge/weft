// A worker's connector grants, made in main (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built).
// Settings → Devices → a worker → Connectors turns GitHub on, changes its settings and allows a project or card, over
// the board-only IPC handler (electron/pairing-ipc.cjs): never a thread or the control server. Turning it on, and any
// change that gives cards more (a wider scope, a weaker approval, a longer lifetime, an ask taken off), takes Touch ID
// first, in words that name the worker; a stricter change doesn't. The row is written with main's own Supabase session,
// so RLS (connector_grants: make/change own, a paired worker of yours) is the last word. Turning it off goes through
// weft.zip instead (lib/connector-remote.ts), which also ends the tokens at GitHub.
//
// SCOPES, APPROVALS, LIFETIMES, ASKS and looser are lib/connector-grant.ts's, held to it by electron/connector-grants.test.ts.

const SCOPES = ["installed", "project", "card"];
const APPROVALS = ["worker", "project", "card"];
const LIFETIMES = ["revoked", "24h", "8h"];
const ASKS = ["protected_push"];
const LIFETIME_MS = { revoked: Infinity, "24h": 24 * 3_600_000, "8h": 8 * 3_600_000 };
const DEFAULTS = { scope: "installed", approval: "worker", lifetime: "revoked", asks: ["protected_push"] };
const CONNECTOR_NAMES = { github: "GitHub as you, with Weft" };
const SHORT_NAMES = { github: "GitHub" };

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

/**
 * @param {(channel: string, fn: (...args: any[]) => unknown) => void} handle the board-only IPC handler
 * @param {{ db: () => any, userId: () => string | null, confirm: (reason: string) => Promise<boolean> }} deps
 */
function registerConnectorGrants(handle, { db, userId, confirm }) {
  // Turns a connector on for a worker, or changes its settings. { denied: true } when Touch ID said no.
  handle("connectors:set", async (workerId, workerName, connector, rawSettings) => {
    const uid = userId();
    if (!uid) throw new Error("Sign in to Weft first.");
    if (!CONNECTOR_NAMES[connector]) throw new Error("Weft doesn't know that connector.");
    const worker = String(workerId);
    const name = clean(workerName || worker, 60);
    const next = settingsOf(rawSettings);
    const { data: was, error } = await db().from("connector_grants").select("scope, approval, lifetime, asks").eq("user_id", uid).eq("worker_id", worker).eq("connector", connector).maybeSingle();
    if (error) throw new Error(`Couldn't read the grant: ${error.message}`);
    if (!was && !(await confirm(`let the worker ${name} use ${CONNECTOR_NAMES[connector]}, for cards you start on it`))) return { denied: true };
    if (was && looser(settingsOf(was), next) && !(await confirm(`give cards on the worker ${name} more ${SHORT_NAMES[connector]} access (${next.scope} repos, approval ${next.approval}, lifetime ${next.lifetime})`))) return { denied: true };
    const row = { worker_id: worker, connector, ...next };
    const write = was ? db().from("connector_grants").update(next).eq("user_id", uid).eq("worker_id", worker).eq("connector", connector) : db().from("connector_grants").insert(row);
    const { error: writeError } = await write;
    if (writeError) throw new Error(`Couldn't save the grant: ${writeError.message}`);
    return { ok: true, settings: next };
  });

  // Allows one project or card under a per-project or per-card approval, after Touch ID.
  handle("connectors:allow", async (grantId, workerName, kind, subject, label) => {
    if (kind !== "project" && kind !== "card") throw new Error("Allow a project or a card.");
    if (!userId()) throw new Error("Sign in to Weft first.");
    const what = kind === "project" ? `the project ${clean(subject, 120)}` : `the card "${clean(label || subject, 80)}"`;
    if (!(await confirm(`let ${what} on the worker ${clean(workerName, 60)} use GitHub as you`))) return { denied: true };
    const { error } = await db().from("connector_allows").insert({ grant_id: String(grantId), kind, subject: String(subject).slice(0, 201) });
    if (error && error.code !== "23505") throw new Error(`Couldn't save the Allow: ${error.message}`);
    return { ok: true };
  });
}

module.exports = { registerConnectorGrants, settingsOf, looser, SCOPES, APPROVALS, LIFETIMES, ASKS };
