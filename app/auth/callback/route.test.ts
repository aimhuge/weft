// /auth/callback: the weft.zip OAuth landing point. The property that matters
// locally is the same one the sign-in route guards: the callback must land on
// the host that wrote the PKCE verifier cookie, or the exchange fails with
// AuthPKCECodeVerifierMissingError and the visitor bounces to
// /login?error=link&reason=exchange.
//
// These tests drive the real route handler with a mocked client and assert that
// the `redirect_to` the sign-in route handed out, the host the callback arrives
// on, and the host the final redirect goes to all agree on ONE origin — for
// both `http://localhost:1024` and `http://127.0.0.1:1024` visitors.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const webClient = vi.fn();
const webUser = vi.fn();
const serviceClient = vi.fn();
vi.mock("@/lib/web-session", () => ({ webClient, webUser, serviceClient }));

vi.mock("@/lib/home", () => ({
  isWebEnabled: (env: Record<string, string | undefined> = process.env) =>
    Boolean(env.VERCEL || env.WEFT_HOME || env.WEFT_WEB),
  isDeployed: (env: Record<string, string | undefined> = process.env) => Boolean(env.VERCEL || env.WEFT_HOME),
}));

// `after` runs the Open Source grant after the response is sent; in a test it
// must not run at all, so it is a no-op that records the call.
const openSourceAfterSignIn = vi.fn();
vi.mock("@/lib/billing/oss-grant", () => ({ openSourceAfterSignIn }));
vi.mock("next/server", () => ({ after: (fn: () => void) => { fn(); } }));

async function load() {
  vi.resetModules();
  return import("./route");
}

function makeRequest(url: string) {
  return new Request(url, { method: "GET" });
}

type OAuthOptions = { provider: string; options: { redirectTo: string; skipBrowserRedirect: boolean } };
type ClientMock = {
  auth: {
    exchangeCodeForSession: ReturnType<typeof vi.fn>;
    signInWithOAuth: ReturnType<typeof vi.fn>;
  };
  from: ReturnType<typeof vi.fn>;
};

function buildClient(): ClientMock {
  return { auth: { exchangeCodeForSession: vi.fn(), signInWithOAuth: vi.fn() }, from: vi.fn() };
}

/** The provider URL `signInWithOAuth` answers with. */
function mockProviderUrl(client: ClientMock, url = "https://github.com/login/oauth/authorize?state=x") {
  client.auth.signInWithOAuth.mockResolvedValue({ data: { url }, error: null });
}

/** A session that looks like a GitHub sign-in. */
function mockSession(client: ClientMock) {
  client.auth.exchangeCodeForSession.mockResolvedValue({
    data: {
      session: {
        provider_token: "gho_x",
        user: { id: "u1", user_metadata: { user_name: "ada" } },
      },
    },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  webUser.mockResolvedValue(null);
  serviceClient.mockReturnValue(null);
  vi.stubEnv("WEFT_WEB", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("WEFT_HOME", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("/auth/callback", () => {
  it("404s when the web board is off", async () => {
    vi.stubEnv("WEFT_WEB", "");
    const { GET } = await load();
    const res = await GET(makeRequest("http://127.0.0.1:1024/auth/callback?code=ok"));
    expect(res.status).toBe(404);
  });

  it("exchanges the code and lands on `next` on the canonical origin", async () => {
    const client = buildClient();
    mockSession(client);
    webClient.mockResolvedValue(client);
    const { GET } = await load();
    const res = await GET(makeRequest("http://127.0.0.1:1024/auth/callback?code=ok&next=%2Fapp"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://127.0.0.1:1024/app");
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith("ok");
  });

  it("moves a callback that arrives on the other loopback name, keeping the code", async () => {
    // The verifier cookie was written for `127.0.0.1`; a callback on `localhost`
    // finds nothing to exchange, so it is moved across first.
    const client = buildClient();
    mockSession(client);
    webClient.mockResolvedValue(client);
    const { GET } = await load();
    const res = await GET(makeRequest("http://localhost:1024/auth/callback?code=ok&next=%2Fapp"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://127.0.0.1:1024/auth/callback?code=ok&next=%2Fapp");
    // Nothing was exchanged yet — the browser has to come back to the right host.
    expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("keeps the visitor on the canonical origin for the whole round trip", async () => {
    // The sign-in route hands Supabase a `redirect_to` on the canonical origin;
    // the callback that comes back must end up on that same origin, whatever
    // loopback name the visitor started from.
    const client = buildClient();
    mockSession(client);
    webClient.mockResolvedValue(client);
    const { GET } = await load();
    const res = await GET(makeRequest("http://localhost:1024/auth/callback?code=ok"));
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin).toBe("http://127.0.0.1:1024");
    // The move keeps the one-time code, so the second hop can exchange it.
    expect(location.pathname).toBe("/auth/callback");
    expect(location.searchParams.get("code")).toBe("ok");
  });

  it("lands on the canonical origin's `next` once the callback is on the canonical host", async () => {
    const client = buildClient();
    mockSession(client);
    webClient.mockResolvedValue(client);
    const { GET } = await load();
    const res = await GET(makeRequest("http://127.0.0.1:1024/auth/callback?code=ok"));
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin).toBe("http://127.0.0.1:1024");
    expect(location.pathname).toBe("/team");
  });

  it("redirects to /login?error=link&reason=provider when the provider errored", async () => {
    const { GET } = await load();
    const res = await GET(makeRequest("http://127.0.0.1:1024/auth/callback?error=access_denied"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://127.0.0.1:1024/login?error=link&reason=provider");
  });

  it("redirects to /login?error=link&reason=nocode when no code comes back", async () => {
    const { GET } = await load();
    const res = await GET(makeRequest("http://127.0.0.1:1024/auth/callback"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://127.0.0.1:1024/login?error=link&reason=nocode");
  });

  it("redirects to /login?error=link&reason=exchange when the code cannot be exchanged", async () => {
    const client = buildClient();
    client.auth.exchangeCodeForSession.mockResolvedValue({
      data: null,
      error: { message: "PKCE code verifier not found in storage" },
    });
    webClient.mockResolvedValue(client);
    const { GET } = await load();
    const res = await GET(makeRequest("http://127.0.0.1:1024/auth/callback?code=bad"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://127.0.0.1:1024/login?error=link&reason=exchange");
  });

  it("redirects to /login?error=link&reason=exchange when the exchange throws", async () => {
    const client = buildClient();
    client.auth.exchangeCodeForSession.mockRejectedValue(new Error("bad code"));
    webClient.mockResolvedValue(client);
    const { GET } = await load();
    const res = await GET(makeRequest("http://127.0.0.1:1024/auth/callback?code=bad"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://127.0.0.1:1024/login?error=link&reason=exchange");
  });

  it("sanitizes an off-origin `next`", async () => {
    const client = buildClient();
    mockSession(client);
    webClient.mockResolvedValue(client);
    const { GET } = await load();
    const res = await GET(
      makeRequest("http://127.0.0.1:1024/auth/callback?code=ok&next=" + encodeURIComponent("//evil.com/x")),
    );
    expect(res.headers.get("location")).toBe("http://127.0.0.1:1024/team");
  });

  it("leaves a deployed origin alone", async () => {
    vi.stubEnv("WEFT_WEB", "");
    vi.stubEnv("VERCEL", "1");
    const client = buildClient();
    mockSession(client);
    webClient.mockResolvedValue(client);
    const { GET } = await load();
    const res = await GET(makeRequest("https://weft.zip/auth/callback?code=ok&next=%2Fapp"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://weft.zip/app");
  });

  it("runs the Open Source grant after a GitHub sign-in", async () => {
    const client = buildClient();
    mockSession(client);
    webClient.mockResolvedValue(client);
    const { GET } = await load();
    await GET(makeRequest("http://127.0.0.1:1024/auth/callback?code=ok"));
    expect(openSourceAfterSignIn).toHaveBeenCalledWith({ userId: "u1", login: "ada", token: "gho_x" });
  });
});

describe("the local round trip end to end", () => {
  // The whole bug in one test: the verifier cookie is host-only, so the host
  // that starts the round trip and the host that finishes it must be the same.
  // Both loopback names are tried, because the visitor picks one.
  for (const host of ["localhost", "127.0.0.1"]) {
    it(`keeps one origin through sign-in and callback for a ${host} visitor`, async () => {
      const client = buildClient();
      mockProviderUrl(client);
      mockSession(client);
      webClient.mockResolvedValue(client);

      const signIn = await import("@/app/auth/sign-in/route");
      const callback = await import("@/app/auth/callback/route");

      // 1. The visitor asks to sign in, on whichever loopback name they typed.
      const start = await signIn.GET(
        makeRequest(`http://${host}:1024/auth/sign-in?provider=github&next=%2Fapp`),
      );
      expect(start.status).toBe(303);

      // 2. Either the provider was asked straight away (we were already on the
      //    canonical host) or the visitor was moved there first.
      const firstHop = new URL(start.headers.get("location") ?? "");
      const canonical = "http://127.0.0.1:1024";
      let onProvider = firstHop.host === "github.com";
      if (!onProvider) {
        expect(firstHop.origin).toBe(canonical);
        expect(firstHop.pathname).toBe("/auth/sign-in");
        // The provider is asked on the second hop, with the canonical redirect_to.
        const second = await signIn.GET(makeRequest(firstHop.toString()));
        expect(second.status).toBe(303);
        onProvider = new URL(second.headers.get("location") ?? "").host === "github.com";
        expect(onProvider).toBe(true);
      }

      // 3. The `redirect_to` the provider was given is the canonical origin.
      const call = client.auth.signInWithOAuth.mock.calls[0] as [OAuthOptions] | undefined;
      const redirectTo = call?.[0]?.options.redirectTo ?? "";
      expect(new URL(redirectTo).origin).toBe(canonical);

      // 4. The provider sends the visitor back to that same origin.
      const back = await callback.GET(makeRequest(`${canonical}/auth/callback?code=ok&next=%2Fapp`));
      expect(back.status).toBe(303);
      expect(back.headers.get("location")).toBe(`${canonical}/app`);
      expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith("ok");
    });
  }
});
