// Shared logic for the weft.zip visitor sign-in. The OAuth round trip goes through
// /auth/sign-in → provider → /auth/callback, with a per-visitor cookie session
// (lib/web-session.ts). The routes under app/auth/ are thin: each parses its input
// and hands the work to one of the helpers here, so the helpers are testable
// without a request. (The desktop's file-based PKCE session lives in lib/auth/server.ts
// and stays untouched; that path can't serve web visitors.)
import type { SupabaseClient } from "@supabase/supabase-js";
import { isDeployed, isWebEnabled } from "./home";
import { safeNextPath } from "./auth/next-path";
import { serviceClient, webClient, webUser, type WebUser } from "./web-session";

// The providers the /auth/sign-in route accepts. Mirrors what the deployed
// /login page exposes today; "google" is wired up too so the seam matches
// lib/account.ts's provider list.
export const WEB_PROVIDERS = ["github", "google"] as const;
export type WebProvider = (typeof WEB_PROVIDERS)[number];

export type WebAuthEnv = Record<string, string | undefined>;

/** True iff `value` is one of the providers the route can start an OAuth round trip for. */
export function isWebProvider(value: unknown): value is WebProvider {
  return typeof value === "string" && (WEB_PROVIDERS as readonly string[]).includes(value);
}

/**
 * The canonical local origin for the web routes, or null when this server is not
 * running the web board locally.
 *
 * The browser may reach the dev server as `localhost` or as `127.0.0.1`, and
 * Supabase matches the OAuth `redirect_to` against its allow-list exactly, so
 * two hosts would mean two allow-list entries. Weft picks one: `127.0.0.1`,
 * the loopback the rest of the codebase already uses (lib/auth/desktop.ts).
 * `WEFT_WEB_ORIGIN` overrides it when the dev server runs on another port.
 */
export function webLocalOrigin(env: WebAuthEnv = process.env): string | null {
  if (!isWebEnabled(env) || isDeployed(env)) return null;
  const configured = env.WEFT_WEB_ORIGIN ?? `http://127.0.0.1:${env.WEFT_WEB_PORT ?? "1024"}`;
  try {
    return new URL(configured).origin;
  } catch {
    // A typo in .env.local must not turn every sign-in into a 500; fall back to
    // the default and let the request's own origin stand.
    return new URL(`http://127.0.0.1:${env.WEFT_WEB_PORT ?? "1024"}`).origin;
  }
}

/** True for the loopback names a dev server answers on. */
function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * The origin the OAuth round trip comes back to.
 *
 * On the deployed site that's the request's own origin — weft.zip, one value.
 *
 * Locally it is the canonical loopback origin (see `webLocalOrigin`), *but*
 * only once the visitor is actually on that host: the PKCE verifier cookie is
 * host-only (no `domain` is ever set), so the host that starts the round trip
 * must be the host that finishes it. `webCanonicalRedirect` moves a visitor
 * that arrived on the other loopback name across before the round trip starts.
 *
 * A non-local request origin is left alone: the deployed site, a preview
 * deployment, or a tunnel must redirect to the host the visitor actually came
 * from, not to the developer's loopback.
 */
export function webCallbackOrigin(requestOrigin: string, env: WebAuthEnv = process.env): string {
  const local = webLocalOrigin(env);
  if (!local) return requestOrigin;
  let hostname: string;
  try {
    hostname = new URL(requestOrigin).hostname;
  } catch {
    return requestOrigin;
  }
  if (!isLoopbackHost(hostname)) return requestOrigin;
  return local;
}

/**
 * The URL a visitor on the wrong loopback name should be sent to before the
 * OAuth round trip starts, or null when they are already in the right place.
 *
 * The sign-in route redirects here first: the verifier cookie is host-only, so
 * starting on `localhost` and coming back to `127.0.0.1` would find no
 * verifier and fail the exchange.
 */
export function webCanonicalRedirect(requestUrl: string, env: WebAuthEnv = process.env): string | null {
  const local = webLocalOrigin(env);
  if (!local) return null;
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (!isLoopbackHost(url.hostname)) return null;
  if (url.origin === local) return null;
  const moved = new URL(url.pathname + url.search, local);
  return moved.toString();
}

/**
 * Build the URL the OAuth provider should bounce back to. The route
 * hands this to `signInWithOAuth({ redirectTo })` so Supabase knows where
 * to send the browser. The `next` is sanitized (only same-origin paths) and
 * re-applied on the callback.
 */
export function webCallbackUrl(origin: string, next: string, defaultNext: string): string {
  const safeNext = safeNextPath(next, defaultNext);
  // Build the URL the long way so the encoded `?next=` doesn't get
  // re-interpreted as part of the path.
  const dest = new URL("/auth/callback", origin);
  dest.searchParams.set("next", safeNext);
  return dest.toString();
}

/**
 * Start an OAuth round trip on the deployed site. Returns either the provider
 * URL the route should 303 to, or a `kind: "error"` result for the cases the
 * route wants to redirect to /login?error=… for. The Supabase client is taken
 * as an argument so tests can pass a mock.
 */
export type WebSignInResult =
  | { kind: "redirect"; url: string }
  | { kind: "error"; reason: "provider" | "missing-url" | "auth-error"; message?: string };

export async function startWebSignIn(
  client: SupabaseClient,
  params: { provider: string; origin: string; next: string; defaultNext: string },
): Promise<WebSignInResult> {
  if (!isWebProvider(params.provider)) return { kind: "error", reason: "provider" };
  const redirectTo = webCallbackUrl(params.origin, params.next, params.defaultNext);
  const { data, error } = await client.auth.signInWithOAuth({
    provider: params.provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) return { kind: "error", reason: "auth-error", message: error.message };
  if (!data.url) return { kind: "error", reason: "missing-url" };
  return { kind: "redirect", url: data.url };
}

/**
 * Build the "link didn't finish" redirect target on /login. The three reasons
 * mirror lib/auth/server.ts's `createAuthCallback` so the form's `?error=link`
 * reader can show the same messages.
 */
export function webAuthFailureUrl(origin: string, reason: "provider" | "nocode" | "exchange"): string {
  const dest = new URL("/login", origin);
  dest.searchParams.set("error", "link");
  dest.searchParams.set("reason", reason);
  return dest.toString();
}

/**
 * Build the "this provider isn't allowed" redirect target on /login. The form
 * renders this when startWebSignIn returns kind:'error' reason:'provider' (and
 * the sign-in route uses it for any startWebSignIn error to keep the
 * destination in one place).
 */
export function webSignInErrorUrl(origin: string, reason: "provider" | "auth-error" | "missing-url"): string {
  const dest = new URL("/login", origin);
  dest.searchParams.set("error", "provider");
  if (reason !== "provider") dest.searchParams.set("reason", reason);
  return dest.toString();
}

/**
 * The /auth/callback handler. Exchanges the one-time `code` for a session
 * (writes the cookies through the client's setAll), best-effort bumps the
 * profile's `last_login_at` / `login_count` through the service client, and
 * returns the URL the route should 303 to.
 *
 * On failure the returned reason maps 1:1 to `?error=link&reason=…`, so the
 * /login form can show "the link expired" the same way it does for the
 * desktop's `/api/auth/callback`.
 */
// Who just signed in with GitHub, for the Open Source check that runs after the redirect (lib/billing/oss-grant.ts).
// The token is GitHub's, valid for this one request: it's handed on, never stored.
export type GithubSignIn = { userId: string; login: string; token: string | null };

export type WebCallbackResult =
  | { kind: "redirect"; url: string; github?: GithubSignIn }
  | { kind: "error"; reason: "provider" | "nocode" | "exchange"; message?: string };

export async function finishWebSignIn(
  client: SupabaseClient,
  params: {
    request: Request;
    code: string | null;
    providerError: string | null;
    next: string;
    defaultNext: string;
    /**
     * The origin the callback landed on. The route passes the same value it
     * computed for the redirect, so the cookie we just set and the URL we
     * redirect to are the same host. Left out, it is derived from the request.
     */
    origin?: string;
  },
): Promise<WebCallbackResult> {
  const { request, code, providerError, next, defaultNext } = params;
  // The same origin the sign-in route pinned, so the cookie we just set and the URL we
  // redirect to are the same host — a browser that reached us as localhost and a
  // callback that lands on 127.0.0.1 must not split the session across two hosts.
  const origin = params.origin ?? webCallbackOrigin(new URL(request.url).origin);
  if (providerError) return { kind: "error", reason: "provider" };
  if (!code) return { kind: "error", reason: "nocode" };
  let github: GithubSignIn | undefined;
  try {
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error) return { kind: "error", reason: "exchange", message: error.message };
    github = githubSignIn(data);
  } catch (err) {
    return { kind: "error", reason: "exchange", message: err instanceof Error ? err.message : String(err) };
  }
  // The PKCE verifier was just dropped into the cookies by `setAll`; the
  // session is now readable. The profile bump is best-effort: a failure
  // there must not block sign-in, but we surface it in the logs.
  const safeNext = safeNextPath(next, defaultNext);
  const dest = new URL(safeNext, origin);
  try {
    await bumpProfile(client);
  } catch (err) {
    console.error("[auth/callback] profile bump failed:", err);
  }
  return github ? { kind: "redirect", url: dest.toString(), github } : { kind: "redirect", url: dest.toString() };
}

type ExchangedSession = { provider_token?: string | null; user?: { id?: string; user_metadata?: Record<string, unknown> } } | null;

// The GitHub login and token of a fresh session, or undefined for a session that didn't come from GitHub.
function githubSignIn(data: { session?: ExchangedSession } | null | undefined): GithubSignIn | undefined {
  const session = data?.session;
  const userId = session?.user?.id;
  if (!session || !userId) return undefined;
  const login = session.user?.user_metadata?.user_name;
  if (typeof login !== "string" || !login) return undefined;
  return { userId, login, token: session.provider_token ?? null };
}

// Reads the user from the just-exchanged session and bumps last_login_at / login_count
// through the service-role client. The service client is only constructed on the deployed
// site (no SUPABASE_SECRET_KEY → no service client → no bump). The cookie-bound client
// is used for the read so the test can pass a mock that doesn't carry the claims yet.
//
// Two updates because login_count needs `+ 1`, which the PostgREST update endpoint
// can't express. A second writer racing the first is fine — both are still a count
// of completed sign-ins, off by at most one — and the failure mode is the same.
async function bumpProfile(client: SupabaseClient, env: WebAuthEnv = process.env): Promise<void> {
  const service = serviceClient(env);
  if (!service) return;
  const { data } = await client.auth.getUser();
  const userId = data.user?.id;
  if (!userId) return;
  const stamp = new Date().toISOString();
  const { error: stampError } = await service
    .from("profiles")
    .update({ last_login_at: stamp })
    .eq("id", userId);
  if (stampError) throw stampError;
  // Read the current count, then write +1. Two round trips, but it's a tiny
  // table and the service client is local to the deployment.
  const { data: row, error: readError } = await service
    .from("profiles")
    .select("login_count")
    .eq("id", userId)
    .single();
  if (readError) throw readError;
  const next = ((row as { login_count?: number } | null)?.login_count ?? 0) + 1;
  const { error: countError } = await service
    .from("profiles")
    .update({ login_count: next })
    .eq("id", userId);
  if (countError) throw countError;
}

/**
 * The /auth/sign-out handler. Signs the visitor out of this device only
 * (scope: "local" so a sign-in on another tab / phone survives), then 303s
 * to /login.
 */
export type WebSignOutResult = { kind: "redirect"; url: string };

export async function webSignOut(
  client: SupabaseClient,
  params: { request: Request; loginPath: string; origin?: string },
): Promise<WebSignOutResult> {
  await client.auth.signOut({ scope: "local" });
  // Same origin rule as the callback: the sign-out clears the host-only cookies,
  // so it has to land on the host that holds them.
  const origin = params.origin ?? webCallbackOrigin(new URL(params.request.url).origin);
  const dest = new URL(params.loginPath, origin);
  return { kind: "redirect", url: dest.toString() };
}

/**
 * Read the signed-in identity for the /login banner. On the deployed site the
 * visitor's session is the cookie session; on `next dev` / desktop there is no
 * web client and we fall back to null. The result is shaped like the
 * `SessionIdentity` the form already accepts.
 */
export type WebSessionIdentity = { id: string; name: string | null; email: string | null; avatar: string | null };

export async function readWebSessionIdentity(
  env: WebAuthEnv = process.env,
  client?: SupabaseClient,
  user?: WebUser | null,
): Promise<WebSessionIdentity | null> {
  if (!isWebEnabled(env)) return null;
  const u = user !== undefined ? user : await webUser(client);
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, avatar: u.avatar };
}

/** Re-export so the route handlers can grab a request-bound client without importing web-session directly. */
export { webClient };
