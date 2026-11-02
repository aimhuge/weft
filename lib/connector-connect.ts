// Connecting GitHub on weft.zip (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built): the Weft
// GitHub App's user-authorization web flow, for the visitor signed in on weft.zip. /start makes a state and a PKCE
// verifier, keeps both in a short-lived httpOnly cookie on this browser and sends you to GitHub; /callback takes them
// back, refuses any mismatch, trades the code (with the verifier) for your user and refresh tokens, and stores them
// sealed for your account. Binding the flow to the signed-in visitor and the browser that started it means a link
// someone else started can't attach your GitHub to their Weft account, or theirs to yours.
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { sealToken } from "./connector-crypto";
import { bound, type TokenDeps } from "./connector-tokens";
import { exchangeCode, githubUser } from "./github-app";

export const CONNECT_COOKIE = "weft_github_connect";
export const CONNECT_PATH = "/api/connectors/github";
export const CONNECT_MAX_AGE = 600;

const b64url = (b: Buffer) => b.toString("base64url");

// A fresh state and verifier, the challenge GitHub gets, and the cookie that carries them back: "<user>.<state>.<verifier>".
export function newConnect(userId: string, bytes: (n: number) => Buffer = randomBytes) {
  const state = b64url(bytes(24));
  const verifier = b64url(bytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { state, challenge, cookie: `${userId}.${state}.${verifier}` };
}

// The verifier, when the cookie belongs to this visitor and names the state GitHub sent back; null otherwise.
export function checkConnect(cookie: string | undefined, userId: string, state: string | null): string | null {
  const [user, kept, verifier] = (cookie ?? "").split(".");
  if (!user || !kept || !verifier || !state) return null;
  return user === userId && kept === state ? verifier : null;
}

export const callbackUrl = (origin: string) => `${origin}${CONNECT_PATH}/callback`;

// Trades the code, reads who it is, and stores the pair sealed for this account. Returns your GitHub login.
export async function finishConnect(deps: TokenDeps, userId: string, o: { code: string; verifier: string; redirectUri: string }): Promise<string> {
  const set = await exchangeCode(deps.cfg, o, deps.fetch, deps.now());
  const who = await githubUser(set.access, deps.fetch);
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
  });
  return who.login;
}

// What the desktop reads (with your session as a bearer): whether you've connected, as whom, and until when the
// refresh token lasts (6 months from the last refresh).
export async function connectStatus(deps: Pick<TokenDeps, "db">, userId: string) {
  const row = await deps.db.tokens(userId);
  return row ? { connected: true, login: row.github_login, refreshExpiresAt: row.refresh_expires_at } : { connected: false };
}

// A plain page for the end of the flow, in the browser pane.
export function donePage(title: string, text: string): Response {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title><body style="font:16px -apple-system,system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem"><h1 style="font-size:1.3rem">${esc(title)}</h1><p>${esc(text)}</p></body>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
