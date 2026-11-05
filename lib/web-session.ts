// Who's signed in on weft.zip: a cookie session per visitor through @supabase/ssr. The desktop's own session
// (lib/account.ts) is a sealed file on your machine, so it can't stand for a visitor on the deployed site; the
// team pages (app/[orgSlug]/team, app/invite) and /login read this one instead. proxy.ts refreshes it on each
// request; Server Components only read it (they can't write cookies). /api/teams is a public JSON API; its
// caller hands a bearer token (the desktop's own Supabase access token) and bearerUser verifies it against
// the project's publishable key — same auth model, different transport.
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL } from "./supabase-project";

export type CookieOptions = Record<string, unknown>;
export type CookieJar = {
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options?: CookieOptions): void;
};

// A Supabase client whose session lives in `jar`. Writes that the jar refuses (a Server Component's read-only
// cookies) are dropped: the proxy already refreshed the session for this request.
export function cookieClient(jar: CookieJar, url = SUPABASE_URL, key = SUPABASE_KEY) {
  return createServerClient(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const c of list) jar.set(c.name, c.value, c.options);
        } catch {
          // Read-only cookies during a render.
        }
      },
    },
  });
}

export type WebClient = ReturnType<typeof cookieClient>;

// The current request's client (Server Components, Route Handlers, Server Actions). connection() first: supabase-js
// reads Date.now() as it builds a client, and under cacheComponents only connection() moves a render past the stage
// where that throws ("unstable value `Date.now()` while prerendering"; cookies() alone isn't enough). Every gate
// (requireTeam, currentWorkspaceSlug, readSessionIdentity) reaches serviceClient() after this, so it's covered too.
export async function webClient(): Promise<WebClient> {
  await connection();
  return cookieClient(await cookies());
}

export type WebUser = { id: string; email: string | null; name: string | null; avatar: string | null };

// Pick the first non-empty string out of a list, used for the optional name/avatar/email fields. A Supabase
// claims payload puts them in `email` and `user_metadata.{full_name,name,user_name,avatar_url,picture}` — we
// try the most specific name first and fall back, so an OAuth provider that only fills `name` still shows.
function pickText(...values: unknown[]): string | null {
  return values.find((v): v is string => typeof v === "string" && v !== "") ?? null;
}

// Map a Supabase Auth claims shape to the plain WebUser the rest of Weft passes around. The cookie session
// and the bearer path both go through this; keeping it in one place means a new claim goes everywhere.
function claimsToUser(claims: Record<string, unknown>): WebUser | null {
  if (typeof claims.sub !== "string" || !claims.sub) return null;
  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
  return {
    id: claims.sub,
    email: pickText(claims.email),
    name: pickText(meta.full_name, meta.name, meta.user_name),
    avatar: pickText(meta.avatar_url, meta.picture),
  };
}

// A stateless Supabase client — no session storage, no auto-refresh — used to verify a JWT the caller sent
// in `Authorization: Bearer <jwt>`. Each call builds a fresh client so no per-request state lives across calls.
function bearerClient() {
  return createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

// The signed-in visitor, from the cookie's JWT (verified against the project's keys), or null.
export async function webUser(client?: WebClient): Promise<WebUser | null> {
  const supabase = client ?? (await webClient());
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims.sub) return null;
  return claimsToUser(data.claims);
}

// The visitor the request's `Authorization: Bearer <jwt>` says they are. Used by /api/teams so the
// desktop's local board can call the deployed Weft's team API on the user's behalf without that machine
// ever holding a cookie for weft.zip. Returns null for a missing, malformed or unverifiable token.
export async function bearerUser(req: Request): Promise<WebUser | null> {
  const jwt = bearerToken(req);
  if (!jwt) return null;
  const { data, error } = await bearerClient().auth.getClaims(jwt);
  if (error || !data?.claims.sub) return null;
  return claimsToUser(data.claims);
}

// The bearer token out of the Authorization header, or null when there isn't one.
function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const jwt = match?.[1]?.trim() ?? "";
  return jwt || null;
}

// A Supabase client that acts as the bearer-token caller, not as the service role.
//
// This matters for the recovery key (app/api/team/vaults/[vaultId]/recovery): the write goes through
// private.share_vault_recovery, which reads auth.uid() to know who is asking and checks that they
// belong to the vault's workspace. The service client has no user, so a service-role call would fail
// that check — the write has to run as the caller.
export function bearerSupabase(req: Request): ReturnType<typeof createClient> | null {
  const jwt = bearerToken(req);
  if (!jwt) return null;
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    // The token is the caller's, so every request carries it and `auth.uid()` is the caller.
    accessToken: () => Promise.resolve(jwt),
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// The service-role client for the deployed Weft's own writes (orgs, memberships, invites). The key is set on
// the Vercel deployment only (SUPABASE_SECRET_KEY); a Weft without it has no team pages.
const makeService = (key: string) => createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
let service: { key: string; client: ReturnType<typeof makeService> } | null = null;
export function serviceClient(env: Record<string, string | undefined> = process.env) {
  const key = env.SUPABASE_SECRET_KEY;
  if (!key) return null;
  if (service?.key !== key) service = { key, client: makeService(key) };
  return service.client;
}

// Who's asking, and a client that reads as them, for a route both the weft.zip board (cookie) and the phone app
// (`Authorization: Bearer <jwt>`, ~/dev/weft-mobile; docs/architecture/mobile.md) call. RLS is the gate either way.
export async function requestSession(req: Request): Promise<{ supabase: WebClient; user: { id: string } | null }> {
  const bearer = bearerSupabase(req);
  if (bearer) return { supabase: bearer as unknown as WebClient, user: await bearerUser(req) };
  const supabase = await webClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}
