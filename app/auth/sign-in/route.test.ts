// /auth/sign-in: the weft.zip OAuth entry. These tests pin the one property the
// whole local round trip depends on: the host that starts the round trip and the
// host the provider comes back to are the SAME host.
//
// The PKCE verifier cookie @supabase/ssr writes is host-only (no `domain` is
// ever set), so a visitor who starts on `localhost` and comes back to
// `127.0.0.1` finds no verifier and the exchange fails with
// AuthPKCECodeVerifierMissingError. The route therefore moves a visitor on the
// wrong loopback name to the canonical one *before* it asks Supabase for the
// provider URL — and the `redirectTo` it hands Supabase is the canonical origin,
// so the allow-list needs one entry, not two.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const webClient = vi.fn();
const webUser = vi.fn();
const serviceClient = vi.fn();
vi.mock("@/lib/web-session", () => ({ webClient, webUser, serviceClient }));

// The real helpers read the env they are handed.
vi.mock("@/lib/home", () => ({
  isWebEnabled: (env: Record<string, string | undefined> = process.env) =>
    Boolean(env.VERCEL || env.WEFT_HOME || env.WEFT_WEB),
  isDeployed: (env: Record<string, string | undefined> = process.env) => Boolean(env.VERCEL || env.WEFT_HOME),
}));

async function load() {
  vi.resetModules();
  return import("./route");
}

function makeRequest(url: string) {
  return new Request(url, { method: "GET" });
}

type OAuthOptions = { provider: string; options: { redirectTo: string; skipBrowserRedirect: boolean } };
type ClientMock = {
  auth: { signInWithOAuth: ReturnType<typeof vi.fn> };
  from: ReturnType<typeof vi.fn>;
};

function buildClient(): ClientMock {
  return { auth: { signInWithOAuth: vi.fn() }, from: vi.fn() };
}

function mockProviderUrl(client: ClientMock, url = "https://github.com/login/oauth/authorize?state=x") {
  client.auth.signInWithOAuth.mockResolvedValue({ data: { url }, error: null });
}

/** The `redirectTo` the route handed to `signInWithOAuth`. */
function redirectTo(client: ClientMock): string {
  const call = client.auth.signInWithOAuth.mock.calls[0] as [OAuthOptions] | undefined;
  return call?.[0]?.options.redirectTo ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  webUser.mockResolvedValue(null);
  serviceClient.mockReturnValue(null);
  // The web board runs locally unless the env says otherwise.
  vi.stubEnv("WEFT_WEB", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("WEFT_HOME", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/auth/sign-in", () => {
  it("404s when the web board is off", async () => {
    vi.stubEnv("WEFT_WEB", "");
    const { GET } = await load();
    const res = await GET(makeRequest("http://127.0.0.1:1024/auth/sign-in?provider=github"));
    expect(res.status).toBe(404);
  });

  it("redirects to the provider with the callback on the same origin", async () => {
    const client = buildClient();
    mockProviderUrl(client);
    webClient.mockResolvedValue(client);
    const { GET } = await load();
    const res = await GET(makeRequest("http://127.0.0.1:1024/auth/sign-in?provider=github"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://github.com/login/oauth/authorize?state=x");
    expect(redirectTo(client)).toBe("http://127.0.0.1:1024/auth/callback?next=%2Fteam");
  });

  it("moves a localhost visitor to the canonical origin before the round trip starts", async () => {
    // The verifier cookie is host-only: starting on `localhost` and coming back
    // to `127.0.0.1` would find no verifier to exchange.
    const client = buildClient();
    mockProviderUrl(client);
    webClient.mockResolvedValue(client);
    const { GET } = await load();
    const res = await GET(makeRequest("http://localhost:1024/auth/sign-in?provider=github&next=%2Fapp"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://127.0.0.1:1024/auth/sign-in?provider=github&next=%2Fapp");
    // The provider was never asked yet — the visitor has to come back first.
    expect(client.auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("keeps the query string when it moves the visitor across", async () => {
    const { GET } = await load();
    const res = await GET(makeRequest("http://localhost:1024/auth/sign-in?provider=github&next=%2Fapp&x=1"));
    expect(res.headers.get("location")).toBe("http://127.0.0.1:1024/auth/sign-in?provider=github&next=%2Fapp&x=1");
  });

  it("does not move a visitor who is already on the canonical origin", async () => {
    const client = buildClient();
    mockProviderUrl(client);
    webClient.mockResolvedValue(client);
    const { GET } = await load();
    const res = await GET(makeRequest("http://127.0.0.1:1024/auth/sign-in?provider=github"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://github.com/login/oauth/authorize?state=x");
    expect(client.auth.signInWithOAuth).toHaveBeenCalledTimes(1);
  });

  it("honours WEFT_WEB_ORIGIN over the default loopback origin", async () => {
    vi.stubEnv("WEFT_WEB_ORIGIN", "http://127.0.0.1:9999");
    const client = buildClient();
    mockProviderUrl(client);
    webClient.mockResolvedValue(client);
    const { GET } = await load();
    const res = await GET(makeRequest("http://127.0.0.1:9999/auth/sign-in?provider=github"));
    // Already on the configured origin: no move, straight to the provider.
    expect(res.headers.get("location")).toBe("https://github.com/login/oauth/authorize?state=x");
    expect(redirectTo(client)).toBe("http://127.0.0.1:9999/auth/callback?next=%2Fteam");
  });

  it("moves a visitor to the configured origin when they are on another loopback name", async () => {
    vi.stubEnv("WEFT_WEB_ORIGIN", "http://127.0.0.1:9999");
    const { GET } = await load();
    const res = await GET(makeRequest("http://localhost:9999/auth/sign-in?provider=github"));
    expect(res.headers.get("location")).toBe("http://127.0.0.1:9999/auth/sign-in?provider=github");
  });

  it("leaves a deployed origin alone", async () => {
    vi.stubEnv("WEFT_WEB", "");
    vi.stubEnv("VERCEL", "1");
    const client = buildClient();
    mockProviderUrl(client);
    webClient.mockResolvedValue(client);
    const { GET } = await load();
    const res = await GET(makeRequest("https://weft.zip/auth/sign-in?provider=github"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://github.com/login/oauth/authorize?state=x");
    expect(redirectTo(client)).toBe("https://weft.zip/auth/callback?next=%2Fteam");
  });

  it("redirects to /login?error=provider for an unknown provider", async () => {
    const client = buildClient();
    webClient.mockResolvedValue(client);
    const { GET } = await load();
    const res = await GET(makeRequest("http://127.0.0.1:1024/auth/sign-in?provider=twitter"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://127.0.0.1:1024/login?error=provider");
    expect(client.auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("redirects to /login?error=provider&reason=auth-error when Supabase rejects", async () => {
    const client = buildClient();
    client.auth.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: { message: "nope" } });
    webClient.mockResolvedValue(client);
    const { GET } = await load();
    const res = await GET(makeRequest("http://127.0.0.1:1024/auth/sign-in?provider=github"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://127.0.0.1:1024/login?error=provider&reason=auth-error");
  });

  it("sanitizes an off-origin `next` before handing it to the provider", async () => {
    const client = buildClient();
    mockProviderUrl(client);
    webClient.mockResolvedValue(client);
    const { GET } = await load();
    await GET(makeRequest("http://127.0.0.1:1024/auth/sign-in?provider=github&next=" + encodeURIComponent("//evil.com/x")));
    expect(redirectTo(client)).toBe("http://127.0.0.1:1024/auth/callback?next=%2Fteam");
  });
});
