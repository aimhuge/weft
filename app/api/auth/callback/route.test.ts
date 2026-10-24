// /api/auth/callback: the OAuth round-trip landing point.
// Mirrors @aimhuge/auth's createAuthCallback; today the body uses the
// file-based PKCE session from lib/account.ts. Verifies the four paths:
// provider error, missing code, exchange failure, success.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/guard", () => ({ guard: () => null }));

const finishSignIn = vi.fn();
const accountClient = vi.fn();
vi.mock("@/lib/account", () => ({
  finishSignIn: (code: string): Promise<unknown> => Promise.resolve(finishSignIn(code)),
  accountClient: (): unknown => accountClient(),
  accountView: () => Promise.resolve({ configured: true, user: null }),
  signOut: () => Promise.resolve(),
  toAccountUser: () => null,
}));

vi.mock("@/lib/home", () => ({ isWebEnabled: () => false }));

async function load() {
  vi.resetModules();
  return import("./route");
}

function makeRequest(url: string) {
  return new Request(url, { method: "GET" });
}

describe("/api/auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects to /login?error=link&reason=provider when the provider errored on the URL", async () => {
    const { GET } = await load();
    const res = await GET(makeRequest("http://127.0.0.1:1000/api/auth/callback?error=access_denied"));
    expect(res.status).toBe(303);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("error=link");
    expect(location).toContain("reason=provider");
  });

  it("redirects with reason=nocode when no code and no error come back", async () => {
    const { GET } = await load();
    const res = await GET(makeRequest("http://127.0.0.1:1000/api/auth/callback"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("reason=nocode");
  });

  it("redirects with reason=exchange when exchangeCodeForSession throws", async () => {
    finishSignIn.mockRejectedValueOnce(new Error("bad code"));
    const { GET } = await load();
    const res = await GET(makeRequest("http://127.0.0.1:1000/api/auth/callback?code=bad"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("reason=exchange");
  });

  it("redirects to `next` (same origin) on success", async () => {
    finishSignIn.mockResolvedValueOnce({ id: "u1", email: "ada@b.co", name: "Ada", avatar: null, provider: "github" });
    const { GET } = await load();
    const res = await GET(makeRequest("http://127.0.0.1:1000/api/auth/callback?code=ok&next=/app"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://127.0.0.1:1000/app");
  });

  it("sanitizes an attacker-controlled `next` (off-site) back to /app", async () => {
    finishSignIn.mockResolvedValueOnce({ id: "u1" });
    const { GET } = await load();
    const res = await GET(
      makeRequest("http://127.0.0.1:1000/api/auth/callback?code=ok&next=" + encodeURIComponent("//evil.com/x")),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://127.0.0.1:1000/app");
  });
});
