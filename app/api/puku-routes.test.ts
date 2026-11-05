import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Puku trial's two routes on the deployed Weft: /api/puku/trial-token and the /api/puku/v1/* proxy.
// lib/puku-proxy and lib/puku-trial-token are mocked; these tests pin the env checks and what the routes pass on.

vi.mock("@/lib/account", () => ({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "anon" }));
vi.mock("@/lib/puku-trial-token", () => ({
  issueTrialToken: vi.fn(() => Promise.resolve(Response.json({ token: "wpt1.a.b", expiresAt: 1 }))),
  accountUserId: vi.fn(() => Promise.resolve("u1")),
}));
vi.mock("@/lib/puku-proxy", () => ({
  DAILY_REQUESTS: 150,
  DAILY_TOKENS: 1_000_000,
  GLOBAL_DAILY_REQUESTS: 15_000,
  GLOBAL_DAILY_TOKENS: 100_000_000,
  apiError: (status: number, type: string, message: string) => Response.json({ type: "error", error: { type, message } }, { status }),
  proxy: vi.fn(() => Promise.resolve(new Response("proxied"))),
  restUsageStore: vi.fn(() => ({ add: vi.fn() })),
}));

const tokens = await import("@/lib/puku-trial-token");
const proxyLib = await import("@/lib/puku-proxy");
const tokenRoute = await import("./puku/trial-token/route");
const proxyRoute = await import("./puku/v1/[...path]/route");

const NAMES = ["PUKU_TRIAL_SIGNING_SECRET", "PUKU_TRIAL_API_KEY", "SUPABASE_SECRET_KEY", "PUKU_TRIAL_DAILY_REQUESTS", "PUKU_TRIAL_DAILY_TOKENS", "PUKU_TRIAL_GLOBAL_DAILY_REQUESTS", "PUKU_TRIAL_GLOBAL_DAILY_TOKENS"];

beforeEach(() => {
  vi.clearAllMocks();
  for (const name of NAMES) vi.stubEnv(name, "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/puku/trial-token", () => {
  const req = () => new Request("https://weft.example/api/puku/trial-token", { method: "POST", headers: { authorization: "Bearer acc" } });

  it("is 503 without the signing secret", async () => {
    const res = await tokenRoute.POST(req());
    expect(res.status).toBe(503);
    expect(tokens.issueTrialToken).not.toHaveBeenCalled();
  });

  it("hands the request to issueTrialToken, checking the sign-in with Supabase Auth", async () => {
    vi.stubEnv("PUKU_TRIAL_SIGNING_SECRET", "sig");
    const res = await tokenRoute.POST(req());
    expect(await res.json()).toEqual({ token: "wpt1.a.b", expiresAt: 1 });
    const [, secret, verify] = vi.mocked(tokens.issueTrialToken).mock.calls[0]!;
    expect(secret).toBe("sig");
    expect(await verify("acc")).toBe("u1");
    expect(tokens.accountUserId).toHaveBeenCalledWith("acc", "https://x.supabase.co", "anon");
  });

  it("is 502 when checking the sign-in throws", async () => {
    vi.stubEnv("PUKU_TRIAL_SIGNING_SECRET", "sig");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(tokens.issueTrialToken).mockRejectedValueOnce(new Error("supabase down"));
    const res = await tokenRoute.POST(req());
    expect(res.status).toBe(502);
    expect(err).toHaveBeenCalledWith("Puku trial token: supabase down");
  });
});

describe("/api/puku/v1/[...path]", () => {
  const call = (path: string[], method: "GET" | "POST" = "POST") =>
    proxyRoute[method](new Request(`https://weft.example/api/puku/v1/${path.join("/")}`, { method }), { params: Promise.resolve({ path }) });
  const configured = () => {
    vi.stubEnv("PUKU_TRIAL_API_KEY", "key");
    vi.stubEnv("PUKU_TRIAL_SIGNING_SECRET", "sig");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");
  };

  it("exports the same handler for GET and POST", () => expect(proxyRoute.GET).toBe(proxyRoute.POST));

  it.each(NAMES.slice(0, 3))("is 503 when %s is missing", async (missing) => {
    configured();
    vi.stubEnv(missing, "");
    const res = await call(["messages"]);
    expect(res.status).toBe(503);
    expect(proxyLib.proxy).not.toHaveBeenCalled();
  });

  it("joins the path and passes the config with default limits", async () => {
    configured();
    const res = await call(["messages", "count_tokens"]);
    expect(await res.text()).toBe("proxied");
    const [, path, config] = vi.mocked(proxyLib.proxy).mock.calls[0]!;
    expect(path).toBe("messages/count_tokens");
    expect(config).toMatchObject({ apiKey: "key", secret: "sig", dailyRequests: 150, dailyTokens: 1_000_000, globalDailyRequests: 15_000, globalDailyTokens: 100_000_000, deadlineMs: 285_000 });
    expect(typeof config.background).toBe("function");
    expect(proxyLib.restUsageStore).toHaveBeenCalledWith("https://x.supabase.co", "sb_secret_x");
    // Billing is configured (SUPABASE_SECRET_KEY is set), so the plan meter rides on the config.
    expect(config).toHaveProperty("plan");
    expect(typeof config.plan?.check).toBe("function");
    expect(typeof config.plan?.record).toBe("function");
  });

  it("takes the daily limits from the env, falling back for invalid values", async () => {
    configured();
    vi.stubEnv("PUKU_TRIAL_DAILY_REQUESTS", "50");
    vi.stubEnv("PUKU_TRIAL_DAILY_TOKENS", "abc");
    await call(["models"], "GET");
    expect(vi.mocked(proxyLib.proxy).mock.calls[0]![2]).toMatchObject({ dailyRequests: 50, dailyTokens: 1_000_000 });
    vi.stubEnv("PUKU_TRIAL_DAILY_REQUESTS", "-1");
    vi.stubEnv("PUKU_TRIAL_DAILY_TOKENS", "1000");
    await call(["models"], "GET");
    expect(vi.mocked(proxyLib.proxy).mock.calls[1]![2]).toMatchObject({ dailyRequests: 150, dailyTokens: 1000 });
  });

  it("takes the whole trial's daily cap from the env too", async () => {
    configured();
    vi.stubEnv("PUKU_TRIAL_GLOBAL_DAILY_REQUESTS", "500");
    vi.stubEnv("PUKU_TRIAL_GLOBAL_DAILY_TOKENS", "0");
    await call(["models"], "GET");
    expect(vi.mocked(proxyLib.proxy).mock.calls[0]![2]).toMatchObject({ globalDailyRequests: 500, globalDailyTokens: 100_000_000 });
  });

  it("is 502 when the proxy throws", async () => {
    configured();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(proxyLib.proxy).mockRejectedValueOnce(new Error("kaput"));
    const res = await call(["messages"]);
    expect(res.status).toBe(502);
    expect(err).toHaveBeenCalledWith("Puku trial proxy: kaput");
  });
});
