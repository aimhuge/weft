// The Weft GitHub App's calls to GitHub, for weft.zip's connector minter
// (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built). Only these: the user-authorization web
// flow (with PKCE), refreshing a user access token, reading who it is, narrowing one to a repo, and deleting a token or
// the whole authorization. Server-only: the client secret is in every call but the first.
//
// Verified against GitHub's docs (2026-11-02): user access tokens (ghu_) live 8 hours and refresh tokens (ghr_) 6
// months while the app's "expire user authorization tokens" is on; refreshing with grant_type=refresh_token returns a
// new pair, and "that refresh token and the old user access token will no longer work"; DELETE
// /applications/{client_id}/token revokes one token and DELETE …/grant every token of the authorization, both with
// Basic auth (client id and secret), 204 on success; POST …/token/scoped narrows a user token to repositories and
// permissions. Not verified: how long a scoped token lives, and whether refreshing its parent ends it.
import "server-only";

export interface AppConfig {
  clientId: string;
  clientSecret: string;
}

// The app's OAuth client, from the deployment's env, or null when it isn't set up (every route then answers 503).
export function appConfig(env: Record<string, string | undefined> = process.env): AppConfig | null {
  const clientId = env.GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export interface TokenSet {
  access: string;
  accessExpiresAt: string;
  refresh: string;
  refreshExpiresAt: string;
}

export type Fetch = typeof fetch;

const OAUTH = "https://github.com/login/oauth";
const API = "https://api.github.com";
const API_HEADERS = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "weft-connector" };
// What a narrowed token may do: the app's own permissions, never more (no workflows, administration or secrets).
export const TOKEN_PERMISSIONS = { contents: "write", pull_requests: "write", metadata: "read" } as const;

export function authorizeUrl(cfg: AppConfig, o: { redirectUri: string; state: string; challenge: string }): string {
  const q = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: o.redirectUri, state: o.state, code_challenge: o.challenge, code_challenge_method: "S256", allow_signup: "false" });
  return `${OAUTH}/authorize?${q.toString()}`;
}

const text = (v: unknown) => (typeof v === "string" && v ? v : null);
const basic = (cfg: AppConfig) => `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`;

// GitHub's token endpoint answers 200 with { error } on a bad code or refresh token, so both are checked.
async function tokenCall(params: Record<string, string>, fetcher: Fetch, now: number): Promise<TokenSet> {
  const res = await fetcher(`${OAUTH}/access_token`, { method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof body.error === "string") throw new Error(`GitHub refused the token request: ${text(body.error_description) ?? text(body.error) ?? `HTTP ${res.status}`}`);
  const { access_token: access, refresh_token: refresh, expires_in: life, refresh_token_expires_in: refreshLife } = body;
  if (typeof access !== "string" || typeof life !== "number") throw new Error("GitHub sent no access token.");
  // An app with "expire user authorization tokens" off sends neither, and its tokens never expire: refused, so a
  // token that lives forever is never handed to a worker.
  if (typeof refresh !== "string" || typeof refreshLife !== "number") throw new Error("The Weft GitHub App must have \"Expire user authorization tokens\" on.");
  return { access, accessExpiresAt: new Date(now + life * 1000).toISOString(), refresh, refreshExpiresAt: new Date(now + refreshLife * 1000).toISOString() };
}

export const exchangeCode = (cfg: AppConfig, o: { code: string; verifier: string; redirectUri: string }, fetcher: Fetch = fetch, now = Date.now()) =>
  tokenCall({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code: o.code, code_verifier: o.verifier, redirect_uri: o.redirectUri }, fetcher, now);

export const refreshTokens = (cfg: AppConfig, refreshToken: string, fetcher: Fetch = fetch, now = Date.now()) =>
  tokenCall({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }, fetcher, now);

export async function githubUser(token: string, fetcher: Fetch = fetch): Promise<{ id: number; login: string }> {
  const res = await fetcher(`${API}/user`, { headers: { ...API_HEADERS, authorization: `Bearer ${token}` } });
  const body = (await res.json().catch(() => ({}))) as { id?: unknown; login?: unknown };
  if (!res.ok || typeof body.id !== "number" || typeof body.login !== "string") throw new Error(`GitHub didn't say who that is (HTTP ${res.status}).`);
  return { id: body.id, login: body.login };
}

// A user token narrowed to one repo and the app's permissions, still acting as you (POST …/token/scoped).
export async function scopedToken(cfg: AppConfig, token: string, repo: string, fetcher: Fetch = fetch): Promise<{ token: string; expiresAt: string | null }> {
  const [owner, name] = repo.split("/");
  const res = await fetcher(`${API}/applications/${cfg.clientId}/token/scoped`, {
    method: "POST",
    headers: { ...API_HEADERS, authorization: basic(cfg), "content-type": "application/json" },
    body: JSON.stringify({ access_token: token, target: owner, repositories: [name], permissions: TOKEN_PERMISSIONS }),
  });
  const body = (await res.json().catch(() => ({}))) as { token?: unknown; expires_at?: unknown; message?: unknown };
  if (!res.ok || typeof body.token !== "string") throw new Error(`GitHub wouldn't narrow the token to ${repo}: ${text(body.message) ?? `HTTP ${res.status}`}`);
  return { token: body.token, expiresAt: typeof body.expires_at === "string" ? body.expires_at : null };
}

// Deletes one token ("token") or the whole authorization ("grant"). True only on GitHub's 204. A 404 isn't proof: GitHub
// answers it for a token it doesn't know, and also for one sent with the wrong app or a token that was already
// replaced, so it reads as unconfirmed (false), as does no answer or anything else (422 included).
export async function deleteAppToken(cfg: AppConfig, token: string, what: "token" | "grant" = "token", fetcher: Fetch = fetch): Promise<boolean> {
  try {
    const res = await fetcher(`${API}/applications/${cfg.clientId}/${what}`, {
      method: "DELETE",
      headers: { ...API_HEADERS, authorization: basic(cfg), "content-type": "application/json" },
      body: JSON.stringify({ access_token: token }),
    });
    return res.status === 204;
  } catch {
    return false;
  }
}
