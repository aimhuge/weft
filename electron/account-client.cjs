// The Weft account's Supabase client in Electron main (docs/architecture/teams-vault.md, "How Electron main
// authenticates to Supabase"). The desktop already holds a session in electron/account-store.cjs, sealed by
// safeStorage; this wraps @supabase/supabase-js so main can read and write the shared-vault tables as the
// signed-in user, and RLS scopes every query to them.
//
// The key rule: main never holds the service-role key. The client is built from the published key
// (lib/supabase-project.ts), the same one the board's own client uses; the secret key stays on the server.
//
// The sealed file (~/.weft/account.sealed) is the single source of truth for the session. Main reads it on
// every call, so a sign-in or a sign-out in the board is seen here at once, and a token refreshed here is
// written back the same way.
//
// CommonJS in electron/ because main can't import a .ts module, so SUPABASE_URL/SUPABASE_KEY are read from
// the same environment variables lib/supabase-project.ts reads, with the same defaults.
const { createAccountStore } = require("./account-store.cjs");

// @supabase/supabase-js is required lazily, not at load: on 2026-10-28 a packaged app whose
// build.files allow-list had dropped the package died here, before a window opened, with a native
// "A JavaScript error occurred in the main process" dialog. A lazy require lets the app boot and
// say what is missing (electron/runtime-deps.cjs checks it at startup). The require itself is
// cached by Node, so this costs nothing after the first call.
let makeClient = null;
// The lazy loader: it returns supabase-js's createClient, and the client is made from it on first use.
function loadCreateClient() {
  if (!makeClient) makeClient = require("@supabase/supabase-js").createClient;
  return makeClient;
}

const SUPABASE_URL = process.env.WEFT_SUPABASE_URL || "https://lqjyravglujyizyqypxq.supabase.co";
const SUPABASE_KEY = process.env.WEFT_SUPABASE_KEY ?? "sb_publishable_DHNc-IYsRJSJkbN38qZNLQ_G59w6uVe";
// The key supabase-js stores the session under (lib/account.ts, "storageKey"). The board and main share it.
const STORAGE_KEY = "weft-auth";

/**
 * The session JSON supabase-js keeps: the access token, the refresh token, the user.
 * @typedef {{ access_token?: string, refresh_token?: string, expires_at?: number, user?: { id?: string, email?: string } }} Session
 */

/** @returns {Session|null} */
function parseSession(raw) {
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// The JWT's claims: the payload, base64url-decoded. Not verified here — Supabase verifies the token it
// receives, and a claim read locally is only ever used to identify the signed-in user, never to grant
// access. An unreadable token has no claims.
/** @returns {Record<string, unknown>|null} */
function decodeClaims(accessToken) {
  if (typeof accessToken !== "string" || !accessToken) return null;
  const parts = accessToken.split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const claims = JSON.parse(json);
    return claims && typeof claims === "object" ? claims : null;
  } catch {
    return null;
  }
}

/**
 * The account client: the session in the sealed file, and a supabase-js client that talks as that user.
 * @param {{ dataDir: string, safeStorage: { isEncryptionAvailable: () => boolean, encryptString: (s: string) => Buffer, decryptString: (b: Buffer) => string } | (() => { isEncryptionAvailable: () => boolean, encryptString: (s: string) => Buffer, decryptString: (b: Buffer) => string }),
 *   url?: string, key?: string, createClient?: Function, fetch?: Function }} deps
 */
function createAccountClient({ dataDir, safeStorage, url = SUPABASE_URL, key = SUPABASE_KEY, createClient: clientFactory = (...args) => loadCreateClient()(...args), fetch: fetchImpl }) {
  // Electron's safeStorage only works once the app is ready, so main may hand over a getter (the shape
  // electron/account-store.cjs's accountRoutesFor takes) and the Keychain is asked for on first use.
  const keychain = typeof safeStorage === "function" ? safeStorage : () => safeStorage;
  const store = createAccountStore({ dataDir, safeStorage: { isEncryptionAvailable: () => keychain().isEncryptionAvailable(), encryptString: (text) => keychain().encryptString(text), decryptString: (buf) => keychain().decryptString(buf) } });
  let client = null;

  // The session as it sits in the sealed file, read fresh every time.
  /** @returns {Session|null} */
  function session() {
    return parseSession(store.read()[STORAGE_KEY]);
  }

  // supabase-js's storage adapter over the sealed file: it reads and writes the same "weft-auth" key the
  // board's client uses, so a sign-in in the board is here at once.
  const storage = {
    getItem: (name) => store.read()[name] ?? null,
    setItem: (name, value) => {
      store.write({ ...store.read(), [name]: value });
    },
    removeItem: (name) => {
      store.write(Object.fromEntries(Object.entries(store.read()).filter(([k]) => k !== name)));
    },
  };

  // A signed-out desktop still answers: a request without a session comes back as a clean error rather than
  // a throw, so a caller can say "sign in" instead of crashing a sync.
  function signedOutResponse() {
    return new Response(JSON.stringify({ message: "Sign in to Weft to use the shared vault." }), {
      status: 401,
      statusText: "Unauthorized",
      headers: { "content-type": "application/json" },
    });
  }

  // The auth endpoints are how we get a token in the first place, so they go out untouched.
  function isAuthRequest(url) {
    const href = typeof url === "string" ? url : url?.url || "";
    return href.includes("/auth/v1/");
  }

  // A 401 means the access token went stale. Refresh inside this wrapper and try once more; the new tokens
  // land in the sealed file through the storage adapter, which is where the board reads them from too.
  async function fetchWithRefresh(input, init) {
    const call = fetchImpl || globalThis.fetch;
    // Signed out: nothing to authenticate with, so the request never leaves the machine and comes back as
    // a clean error. The auth endpoints are how one signs in, so they go out.
    if (!session()?.access_token && !isAuthRequest(input)) return signedOutResponse();
    const response = await call(input, init);
    if (response.status !== 401 || isAuthRequest(input)) return response;
    const current = session();
    if (!current?.refresh_token) return response;
    const refreshed = await refresh();
    if (!refreshed?.access_token) return response;
    // The retry carries the new bearer token; the stale one in the old headers is replaced.
    const headers = new Headers(init?.headers || {});
    headers.set("Authorization", `Bearer ${refreshed.access_token}`);
    return call(input, { ...init, headers });
  }

  // The refresh itself: supabase-js's own refresh, which writes the new session through the storage adapter.
  // Returns the new session, or null when the refresh token is gone or rejected.
  async function refresh() {
    if (!client) return null;
    const { data, error } = await client.auth.refreshSession();
    if (error || !data?.session) return null;
    // supabase-js already persisted the session through the adapter; make sure the sealed file has it even
    // when that write was skipped (a session that didn't change still has to be findable).
    const serialized = JSON.stringify(data.session);
    if (store.read()[STORAGE_KEY] !== serialized) storage.setItem(STORAGE_KEY, serialized);
    return data.session;
  }

  function build() {
    return clientFactory(url, key, {
      auth: {
        flowType: "pkce",
        storage,
        storageKey: STORAGE_KEY,
        persistSession: true,
        // Main refreshes on its own (a 401 above); the client's timer would refresh behind the board's back.
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { fetch: fetchWithRefresh },
    });
  }

  return {
    // The raw session map in the sealed file, for callers that want the tokens themselves (main's Vercel
    // push does). Never logged, never put in a thread.
    read: () => store.read(),
    write: (data) => store.write(data),
    /** @returns {Record<string, unknown>|null} */
    getClaims: () => decodeClaims(session()?.access_token),
    // The client, made on first use: main may start before the user has ever signed in. A request made while
    // signed out comes back as a clean error, not a throw.
    get supabase() {
      client ??= build();
      return client;
    },
    // Whether there is a session at all, for a caller that would rather not make a request.
    signedIn: () => Boolean(session()?.access_token),
  };
}

module.exports = { createAccountClient, decodeClaims, STORAGE_KEY };
