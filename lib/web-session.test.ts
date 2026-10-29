// lib/web-session.ts: the cookie-bound Supabase client, the JWT-derived WebUser, and the service-role
// client. We mock @supabase/ssr's createServerClient and @supabase/supabase-js's createClient so the
// module-under-test only sees the options we want to assert.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// vi.hoisted runs before vi.mock so the factories can close over the mocks without a TDZ error.
const { createServerClient, createClient, cookies, connection } = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  createClient: vi.fn(),
  cookies: vi.fn(),
  connection: vi.fn(() => Promise.resolve()),
}));

vi.mock("@supabase/ssr", () => ({ createServerClient }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
vi.mock("./supabase-project", () => ({
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_KEY: "sb_publishable_test",
}));
vi.mock("next/headers", () => ({ cookies }));
vi.mock("next/server", () => ({ connection }));

async function load() {
  vi.resetModules();
  return import("./web-session");
}

beforeEach(() => {
  vi.clearAllMocks();
  createServerClient.mockReturnValue({ auth: { getClaims: vi.fn() } });
  createClient.mockReturnValue({ auth: { getClaims: vi.fn() } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cookieClient", () => {
  it("wires getAll and setAll to the cookie jar", async () => {
    const { cookieClient } = await load();
    const jar = { getAll: vi.fn(() => [{ name: "sb", value: "tok" }]), set: vi.fn() };
    cookieClient(jar);
    const [, , opts] = createServerClient.mock.calls[0] as [string, string, { cookies: { getAll: () => unknown; setAll: (l: unknown[]) => void } }];
    expect(opts.cookies.getAll()).toEqual([{ name: "sb", value: "tok" }]);
    opts.cookies.setAll([{ name: "sb", value: "new", options: { path: "/" } }]);
    expect(jar.set).toHaveBeenCalledWith("sb", "new", { path: "/" });
  });

  it("swallows a throwing jar.set so a Server Component can still read the session", async () => {
    const { cookieClient } = await load();
    const jar = { getAll: vi.fn(() => []), set: vi.fn(() => { throw new Error("read-only"); }) };
    cookieClient(jar);
    const [, , opts] = createServerClient.mock.calls[0] as [string, string, { cookies: { setAll: (l: unknown[]) => void } }];
    expect(() => opts.cookies.setAll([{ name: "sb", value: "v", options: undefined }])).not.toThrow();
    expect(jar.set).toHaveBeenCalled();
  });

  it("uses the SUPABASE_URL and SUPABASE_KEY by default", async () => {
    const { cookieClient } = await load();
    cookieClient({ getAll: vi.fn(() => []), set: vi.fn() });
    const [url, key] = createServerClient.mock.calls[0] as [string, string];
    expect(url).toBe("https://test.supabase.co");
    expect(key).toBe("sb_publishable_test");
  });

  it("honors custom url and key arguments", async () => {
    const { cookieClient } = await load();
    cookieClient({ getAll: vi.fn(() => []), set: vi.fn() }, "https://other.supabase.co", "other_key");
    const [url, key] = createServerClient.mock.calls[0] as [string, string];
    expect(url).toBe("https://other.supabase.co");
    expect(key).toBe("other_key");
  });
});

describe("webClient", () => {
  it("awaits cookies() and returns a cookieClient bound to the jar", async () => {
    const { webClient } = await load();
    const jar = { getAll: vi.fn(() => []), set: vi.fn() };
    cookies.mockResolvedValue(jar);
    const client = await webClient();
    expect(cookies).toHaveBeenCalled();
    const [, , opts] = createServerClient.mock.calls[0] as [string, string, { cookies: { getAll: () => unknown } }];
    expect(opts.cookies.getAll()).toEqual([]);
    // The cookieClient mock returns a fresh `auth` object each call; assert
    // the shape (an `auth.getClaims` function) rather than identity.
    expect(typeof client.auth.getClaims).toBe("function");
  });

  it("awaits connection() before it builds the client, so supabase-js's Date.now() is past the prerender", async () => {
    const { webClient } = await load();
    cookies.mockResolvedValue({ getAll: vi.fn(() => []), set: vi.fn() });
    await webClient();
    expect(connection).toHaveBeenCalled();
    expect(connection.mock.invocationCallOrder[0]).toBeLessThan(createServerClient.mock.invocationCallOrder[0]!);
  });
});

describe("webUser", () => {
  // A minimal client with the auth.getClaims the module calls. Returns whatever the test queues.
  function clientWith(claims: unknown, error: unknown = null) {
    return {
      auth: { getClaims: vi.fn().mockResolvedValue({ data: claims === undefined ? null : { claims }, error }) },
    } as unknown as SupabaseClient;
  }

  it("maps sub/email and picks name from full_name", async () => {
    const { webUser } = await load();
    const client = clientWith({ sub: "u1", email: "ada@b.co", user_metadata: { full_name: "Ada Lovelace" } });
    expect(await webUser(client)).toEqual({ id: "u1", email: "ada@b.co", name: "Ada Lovelace", avatar: null });
  });

  it("falls back across name keys (full_name → name → user_name)", async () => {
    const { webUser } = await load();
    const onlyName = clientWith({ sub: "u2", user_metadata: { name: "Grace" } });
    expect((await webUser(onlyName))?.name).toBe("Grace");
    const onlyUserName = clientWith({ sub: "u3", user_metadata: { user_name: "grace" } });
    expect((await webUser(onlyUserName))?.name).toBe("grace");
  });

  it("falls back across avatar keys (avatar_url → picture)", async () => {
    const { webUser } = await load();
    const avatarUrl = clientWith({ sub: "u1", user_metadata: { avatar_url: "https://a/1.png" } });
    expect((await webUser(avatarUrl))?.avatar).toBe("https://a/1.png");
    const picture = clientWith({ sub: "u1", user_metadata: { picture: "https://a/2.png" } });
    expect((await webUser(picture))?.avatar).toBe("https://a/2.png");
  });

  it("treats empty strings as missing", async () => {
    const { webUser } = await load();
    const blank = clientWith({ sub: "u1", user_metadata: { full_name: "", name: "Real", avatar_url: "" } });
    expect((await webUser(blank))?.name).toBe("Real");
    expect((await webUser(blank))?.avatar).toBeNull();
  });

  it("returns null when getClaims reports an error or no sub", async () => {
    const { webUser } = await load();
    expect(await webUser(clientWith({ sub: "u1" }, { message: "expired" }))).toBeNull();
    expect(await webUser(clientWith(undefined))).toBeNull();
    expect(await webUser(clientWith({}))).toBeNull();
    expect(await webUser(clientWith({ sub: "" }))).toBeNull();
  });

  it("calls webClient when no client is given", async () => {
    const { webUser } = await load();
    const jar = { getAll: vi.fn(() => []), set: vi.fn() };
    cookies.mockResolvedValue(jar);
    createServerClient.mockReturnValue({
      auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "u_from_web", user_metadata: {} } }, error: null }) },
    });
    expect(await webUser()).toMatchObject({ id: "u_from_web" });
    expect(cookies).toHaveBeenCalled();
  });

  it("does not call cookies when a client is passed", async () => {
    const { webUser } = await load();
    const client = clientWith({ sub: "u_passed", user_metadata: {} });
    expect(await webUser(client)).toMatchObject({ id: "u_passed" });
    expect(cookies).not.toHaveBeenCalled();
  });

  it("handles a missing user_metadata and null email", async () => {
    const { webUser } = await load();
    const bare = clientWith({ sub: "u1" });
    expect(await webUser(bare)).toEqual({ id: "u1", email: null, name: null, avatar: null });
  });
});

describe("bearerUser", () => {
  function bearerWith(claims: unknown, error: unknown = null) {
    const getClaims = vi.fn().mockResolvedValue({ data: claims === undefined ? null : { claims }, error });
    createClient.mockReturnValueOnce({ auth: { getClaims } });
    return getClaims;
  }

  function req(header: string | null) {
    return new Request("https://weft.example/api/teams", { headers: header ? { authorization: header } : {} });
  }

  it("returns null when the Authorization header is missing", async () => {
    const { bearerUser } = await load();
    expect(await bearerUser(req(null))).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns null for a header that isn't a Bearer", async () => {
    const { bearerUser } = await load();
    expect(await bearerUser(req("Basic abc"))).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns null for a bearer with an empty token", async () => {
    const { bearerUser } = await load();
    expect(await bearerUser(req("Bearer    "))).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("verifies a JWT with a stateless Supabase client and maps the claims", async () => {
    const { bearerUser } = await load();
    const getClaims = bearerWith({ sub: "u1", email: "ada@b.co", user_metadata: { full_name: "Ada" } });
    const out = await bearerUser(req("Bearer jwt.tok.en"));
    expect(out).toEqual({ id: "u1", email: "ada@b.co", name: "Ada", avatar: null });
    // A stateless client (no session storage, no auto-refresh) is what bearer paths expect.
    const [url, key, opts] = createClient.mock.calls[0] as [string, string, { auth: Record<string, unknown> }];
    expect(url).toBe("https://test.supabase.co");
    expect(key).toBe("sb_publishable_test");
    expect(opts.auth).toEqual({ persistSession: false, autoRefreshToken: false });
    expect(getClaims).toHaveBeenCalledWith("jwt.tok.en");
  });

  it("returns null on an error, missing sub, or absent claims", async () => {
    const { bearerUser } = await load();
    bearerWith({ sub: "u1" }, { message: "expired" });
    expect(await bearerUser(req("Bearer x"))).toBeNull();
    bearerWith(undefined);
    expect(await bearerUser(req("Bearer x"))).toBeNull();
    bearerWith({});
    expect(await bearerUser(req("Bearer x"))).toBeNull();
    bearerWith({ sub: "" });
    expect(await bearerUser(req("Bearer x"))).toBeNull();
  });

  it("accepts a lowercase 'bearer' scheme", async () => {
    const { bearerUser } = await load();
    bearerWith({ sub: "u1", user_metadata: {} });
    expect(await bearerUser(req("bearer x.y.z"))).toMatchObject({ id: "u1" });
  });
});

describe("requestSession", () => {
  it("reads as the bearer caller when the request carries a token", async () => {
    const { requestSession } = await load();
    const getClaims = vi.fn().mockResolvedValue({ data: { claims: { sub: "u9" } }, error: null });
    const bearer = { storage: {} };
    createClient.mockReturnValueOnce(bearer).mockReturnValueOnce({ auth: { getClaims } });
    const out = await requestSession(new Request("https://w.x/", { headers: { authorization: "Bearer t.o.k" } }));
    expect(out.supabase).toBe(bearer);
    expect(out.user).toMatchObject({ id: "u9" });
    expect(cookies).not.toHaveBeenCalled();
  });

  it("falls back to the cookie session without a token", async () => {
    const { requestSession } = await load();
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } });
    createServerClient.mockReturnValueOnce({ auth: { getUser } });
    cookies.mockResolvedValueOnce({ getAll: () => [], set: vi.fn() });
    const out = await requestSession(new Request("https://w.x/"));
    expect(out.user).toEqual({ id: "u1" });
  });
});

describe("serviceClient", () => {
  it("is null when SUPABASE_SECRET_KEY is unset", async () => {
    const { serviceClient } = await load();
    expect(serviceClient({})).toBeNull();
    expect(serviceClient({ SUPABASE_SECRET_KEY: "" })).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("builds a service-role Supabase client from the secret key", async () => {
    const { serviceClient } = await load();
    serviceClient({ SUPABASE_SECRET_KEY: "sb_secret_1" });
    expect(createClient).toHaveBeenCalledTimes(1);
    const [url, key, opts] = createClient.mock.calls[0] as [string, string, { auth: Record<string, unknown> }];
    expect(url).toBe("https://test.supabase.co");
    expect(key).toBe("sb_secret_1");
    expect(opts.auth).toEqual({ persistSession: false, autoRefreshToken: false });
  });

  it("memoizes the client per key", async () => {
    const { serviceClient } = await load();
    const a = serviceClient({ SUPABASE_SECRET_KEY: "sb_secret_a" });
    const b = serviceClient({ SUPABASE_SECRET_KEY: "sb_secret_a" });
    expect(a).toBe(b);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("builds a fresh client when the key changes", async () => {
    const { serviceClient } = await load();
    serviceClient({ SUPABASE_SECRET_KEY: "sb_secret_a" });
    serviceClient({ SUPABASE_SECRET_KEY: "sb_secret_b" });
    expect(createClient).toHaveBeenCalledTimes(2);
  });

  it("defaults to process.env when no env argument is given", async () => {
    const { serviceClient } = await load();
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_env");
    try {
      const client = serviceClient();
      expect(client).toBeTruthy();
      const [, key] = createClient.mock.calls[0] as [string, string];
      expect(key).toBe("sb_secret_env");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
