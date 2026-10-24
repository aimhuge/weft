// proxy.ts: refreshes the weft.zip visitor's Supabase session cookie before the team pages render.
// vitest.config.ts only globs lib/**, so this test lives at lib/proxy.test.ts and imports from the
// repo root via "../proxy". Mock @supabase/ssr so we can assert the cookie wiring without a real
// Supabase project. Use real NextRequest from "next/server" so request.cookies and response.cookies
// are the same types the proxy writes through.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted runs before vi.mock so the factory can close over the mock without a TDZ error.
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({ createServerClient }));
// supabase-project is doMocked per test (the proxy checks SUPABASE_KEY, which differs between the
// "deployed" and "no key" branches).

async function load() {
  vi.resetModules();
  return import("../proxy");
}

function mockProject(supabaseKey: string) {
  vi.doMock("@/lib/supabase-project", () => ({
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_KEY: supabaseKey,
  }));
}

beforeEach(() => {
  mockProject("sb_publishable_test");
  vi.clearAllMocks();
  // Default: getClaims resolves with an empty session (no setAll triggered).
  createServerClient.mockReturnValue({ auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: null }, error: null }) } });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/supabase-project");
});

function makeRequest(url: string, init: ConstructorParameters<typeof NextRequest>[1] = {}) {
  return new NextRequest(url, init);
}

describe("proxy (not deployed)", () => {
  it("passes straight through when neither VERCEL nor WEFT_HOME is set", async () => {
    // WEFT_WEB is stubbed empty on purpose: a developer's .env.local may set it (the web
    // routes on a local server), and then the proxy does refresh — this case is the plain
    // desktop one, where the web routes are off.
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("WEFT_HOME", "");
    vi.stubEnv("WEFT_WEB", "");
    const { proxy, config } = await load();
    const res = await proxy(makeRequest("https://weft.zip/team"));
    expect(res.status).toBe(200);
    // createServerClient is only called on the deployed path; on `next dev` it should never run.
    expect(createServerClient).not.toHaveBeenCalled();
    expect(config.matcher).toContain("/:orgSlug/team/:path*");
  });
});

describe("proxy (deployed)", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL", "1");
  });

  it("calls createServerClient and getClaims, returning a response with no refreshed cookies when the session is fresh", async () => {
    const { proxy } = await load();
    const req = makeRequest("https://weft.zip/team");
    const res = await proxy(req);
    expect(res.status).toBe(200);
    expect(createServerClient).toHaveBeenCalledTimes(1);
    const [url, key, opts] = createServerClient.mock.calls[0] as [string, string, { cookies: { getAll: () => unknown; setAll: (l: unknown[]) => void } }];
    expect(url).toBe("https://test.supabase.co");
    expect(key).toBe("sb_publishable_test");
    // getAll wires to request.cookies.getAll()
    const cookies = req.cookies.getAll();
    expect(cookies).toEqual([]);
    // setAll is wired; calling it with nothing should not throw
    opts.cookies.setAll([]);
  });

  it("copies cookies that setAll writes onto the response", async () => {
    // This time setAll is invoked with a refreshed token, so the proxy must mirror it on the response.
    createServerClient.mockImplementation((_url: string, _key: string, opts: { cookies: { setAll: (l: { name: string; value: string; options?: unknown }[]) => void } }) => ({
      auth: {
        getClaims: vi.fn().mockImplementation(() => {
          // Simulate Supabase refreshing the session by writing two cookies through setAll.
          opts.cookies.setAll([
            { name: "sb-access-token", value: "new-access", options: { path: "/", maxAge: 3600 } },
            { name: "sb-refresh-token", value: "new-refresh", options: { path: "/", maxAge: 60 * 60 * 24 * 30 } },
          ]);
          return Promise.resolve({ data: { claims: { sub: "u1" } }, error: null });
        }),
      },
    }));
    const { proxy } = await load();
    const res = await proxy(makeRequest("https://weft.zip/team"));
    // NextResponse.cookies uses .get(name) to look up by name; verify both cookies came through.
    const access = res.cookies.get("sb-access-token");
    const refresh = res.cookies.get("sb-refresh-token");
    expect(access?.value).toBe("new-access");
    expect(refresh?.value).toBe("new-refresh");
  });

  it("passes through when WEFT_HOME is set instead of VERCEL", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("WEFT_HOME", "1");
    const { proxy } = await load();
    const res = await proxy(makeRequest("https://weft.zip/login"));
    expect(res.status).toBe(200);
    expect(createServerClient).toHaveBeenCalledTimes(1);
  });
});

describe("proxy (local web)", () => {
  it("refreshes the session when WEFT_WEB=1, even off Vercel", async () => {
    // WEFT_WEB=1 turns the weft.zip routes on for a local server. The visitor's cookie
    // session has to be refreshed there too, or an expired access token bounces them
    // back to "signed out" on the very pages that need the session.
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("WEFT_HOME", "");
    vi.stubEnv("WEFT_WEB", "1");
    const { proxy } = await load();
    const res = await proxy(makeRequest("http://127.0.0.1:1024/team"));
    expect(res.status).toBe(200);
    expect(createServerClient).toHaveBeenCalledTimes(1);
  });

  it("still passes straight through without WEFT_WEB", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("WEFT_HOME", "");
    vi.stubEnv("WEFT_WEB", "");
    const { proxy } = await load();
    const res = await proxy(makeRequest("http://127.0.0.1:1024/team"));
    expect(res.status).toBe(200);
    expect(createServerClient).not.toHaveBeenCalled();
  });
});

describe("proxy (deployed but no key)", () => {
  it("passes through when SUPABASE_KEY is empty even on the deployed build", async () => {
    vi.stubEnv("VERCEL", "1");
    mockProject("");
    const { proxy } = await load();
    const res = await proxy(makeRequest("https://weft.zip/team"));
    expect(res.status).toBe(200);
    expect(createServerClient).not.toHaveBeenCalled();
  });
});

describe("config.matcher", () => {
  it("matches the weft.zip session routes, including the per-workspace team page", async () => {
    const { config } = await load();
    expect(config.matcher).toContain("/login");
    expect(config.matcher).toContain("/app");
    expect(config.matcher).toContain("/team");
    expect(config.matcher).toContain("/invite/:token*");
    expect(config.matcher).toContain("/:orgSlug/team/:path*");
  });
});
