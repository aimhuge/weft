// Connecting GitHub on weft.zip (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built): the Weft
// GitHub App's user-authorization web flow, for the visitor signed in on weft.zip. GET /start shows one button; its
// POST (same-origin only, so another site can't start a flow in your browser) ends any earlier connection at GitHub,
// makes a state and a PKCE verifier, keeps both in a short-lived httpOnly cookie (__Host- on https, and MACed with a
// key derived from WEFT_CONNECTOR_TOKEN_KEY, so it can't be forged or planted from a subdomain) and sends you to
// GitHub. /callback takes them back, refuses any mismatch, trades the code (with the verifier) for your user and refresh
// tokens, and stores them sealed for your account. Binding the flow to the signed-in visitor and the browser that
// started it means a link someone else started can't attach your GitHub to their Weft account, or theirs to yours.
import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sealToken, type ConnectorKey } from "./connector-crypto";
import { bound, MintError, type TokenDeps } from "./connector-tokens";
import { endAuthorization, forgetGithub } from "./connector-revoke";
import { notice } from "./connector-notify";
import { deleteAppToken, exchangeCode, githubUser } from "./github-app";

export const CONNECT_PATH = "/api/connectors/github";
export const CONNECT_MAX_AGE = 600;
// __Host- needs Secure, so a local http server (WEFT_WEB=1) uses the plain name.
export const connectCookie = (secure: boolean) => (secure ? "__Host-weft_github_connect" : "weft_github_connect");

const b64url = (b: Buffer) => b.toString("base64url");
const macOf = (key: ConnectorKey, payload: string) => b64url(createHmac("sha256", createHmac("sha256", key.key).update("weft-connect-cookie-v1").digest()).update(payload).digest());

// A fresh state and verifier, the challenge GitHub gets, and the cookie that carries them back:
// "<user>.<state>.<verifier>.<previous github id or ->.<mac>".
export function newConnect(userId: string, key: ConnectorKey, previous: number | null, bytes: (n: number) => Buffer = randomBytes) {
  const state = b64url(bytes(24));
  const verifier = b64url(bytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const payload = `${userId}.${state}.${verifier}.${previous ?? "-"}`;
  return { state, challenge, cookie: `${payload}.${macOf(key, payload)}` };
}

// The verifier and the GitHub account connected before, when the cookie is ours, belongs to this visitor and names
// the state GitHub sent back; null otherwise.
export function checkConnect(cookie: string | undefined, userId: string, state: string | null, key: ConnectorKey): { verifier: string; previous: number | null } | null {
  const parts = (cookie ?? "").split(".");
  if (parts.length !== 5 || !state) return null;
  const [user, kept, verifier, prev, mac] = parts as [string, string, string, string, string];
  const want = Buffer.from(macOf(key, `${user}.${kept}.${verifier}.${prev}`));
  const got = Buffer.from(mac);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  if (user !== userId || kept !== state) return null;
  return { verifier, previous: /^\d+$/.test(prev) ? Number(prev) : null };
}

// Whether a request came from a page on this origin (the Connect button), never another site's form or link.
export function sameOrigin(req: Request, origin: string): boolean {
  const site = req.headers.get("sec-fetch-site");
  const from = req.headers.get("origin");
  return site === "same-origin" && (from === null || from === origin);
}

export const callbackUrl = (origin: string) => `${origin}${CONNECT_PATH}/callback`;

// Before a new connection: the old authorization deleted at GitHub (its tokens end) and forgotten once GitHub
// confirmed. Returns the GitHub account that was connected, so the callback can tell a different one.
export async function endPrevious(deps: TokenDeps, userId: string): Promise<number | null> {
  const row = await deps.db.tokens(userId);
  if (!row) return null;
  await deps.db.saveTokens({ user_id: userId, disconnect_pending_at: new Date(deps.now()).toISOString() });
  if ((await endAuthorization(deps, userId)) === "deleted") await forgetGithub(deps, userId);
  return row.github_id;
}

// Trades the code, reads who it is, and stores the pair sealed for this account. Returns your GitHub login.
// A different GitHub account than before: refused while the old one's authorization isn't confirmed gone, and once it
// is, every worker's grant goes (you approved the other account) and you're told.
export async function finishConnect(deps: TokenDeps, userId: string, o: { code: string; verifier: string; redirectUri: string; previous: number | null }): Promise<string> {
  const set = await exchangeCode(deps.cfg, o, deps.fetch, deps.now());
  const who = await githubUser(set.access, deps.fetch);
  const pending = await deps.db.tokens(userId);
  if (pending && pending.github_id !== who.id) {
    await deleteAppToken(deps.cfg, set.access, "grant", deps.fetch);
    throw new MintError(409, `GitHub didn't confirm that Weft's authorization for @${pending.github_login} is gone. Remove Weft at github.com/settings/apps/authorizations, then connect again.`);
  }
  const changed = (o.previous ?? who.id) !== who.id;
  if (changed) await deps.db.deleteGrants(userId, "github");
  await deps.db.saveTokens({
    user_id: userId,
    github_id: who.id,
    github_login: who.login,
    refresh_sealed: sealToken(set.refresh, bound.refresh(userId), deps.key),
    refresh_expires_at: set.refreshExpiresAt,
    access_sealed: sealToken(set.access, bound.access(userId), deps.key),
    access_issued_at: new Date(deps.now()).toISOString(),
    access_expires_at: set.accessExpiresAt,
    refreshing_until: null,
    disconnect_pending_at: null,
  });
  if (changed) await notice(deps, userId, { subject: `GitHub reconnected as @${who.login}`, text: `Weft now acts as @${who.login} on GitHub. Your workers' GitHub grants were for the account connected before, so they were turned off: turn GitHub on again for each one you want.` });
  return who.login;
}

// What the desktop reads (with your session as a bearer): whether you've connected, as whom, and until when the
// refresh token lasts (6 months from the last refresh). A disconnect GitHub didn't confirm reads as pending.
export async function connectStatus(deps: Pick<TokenDeps, "db">, userId: string) {
  const row = await deps.db.tokens(userId);
  if (!row) return { connected: false };
  if (row.disconnect_pending_at) return { connected: false, pendingDisconnect: true, login: row.github_login };
  return { connected: true, login: row.github_login, refreshExpiresAt: row.refresh_expires_at };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const PAGE_STYLE = "font:16px -apple-system,system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem";
// No framing (so the button can't be clickjacked), no scripts, and forms only to here and GitHub.
const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://github.com; frame-ancestors 'none'",
};

// A plain page for the end of the flow, in the browser pane.
export function donePage(title: string, text: string): Response {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title><body style="${PAGE_STYLE}"><h1 style="font-size:1.3rem">${esc(title)}</h1><p>${esc(text)}</p></body>`;
  return new Response(html, { headers: PAGE_HEADERS });
}

// The start page: one button that POSTs the start, so only a click on weft.zip itself begins a flow.
export function startPage(login: string | null): Response {
  const again = login ? ` This ends Weft's current connection as @${esc(login)} first.` : "";
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect GitHub</title><body style="${PAGE_STYLE}"><h1 style="font-size:1.3rem">Connect GitHub to Weft</h1><p>Your workers' cards will push and use gh as you, with Weft, once you turn GitHub on for a worker.${again}</p><form method="post" action="${CONNECT_PATH}/start"><button type="submit" style="font:inherit;padding:.5rem 1rem">Continue to GitHub</button></form></body>`;
  return new Response(html, { headers: PAGE_HEADERS });
}

// A page with one button that POSTs back to `action` with `fields`, for an emailed link: opening the link shows it,
// only pressing the button acts (lib/connector-signer-links.ts), so a mail scanner that fetches links does nothing.
export function buttonPage(title: string, text: string, action: string, fields: Record<string, string>, button: string): Response {
  const inputs = Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("");
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title><body style="${PAGE_STYLE}"><h1 style="font-size:1.3rem">${esc(title)}</h1><p>${esc(text)}</p><form method="post" action="${esc(action)}">${inputs}<button type="submit" style="font:inherit;padding:.5rem 1rem">${esc(button)}</button></form></body>`;
  return new Response(html, { headers: PAGE_HEADERS });
}
