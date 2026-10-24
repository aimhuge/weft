import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The deployed Weft's /api/billing/checkout route: bearer auth, the service client, the body it accepts, and the
// upgrade it starts. The sibling app/api/billing/status/route.test.ts is the closest pattern.

const { accountUserId, billingService, startUpgrade, upgradeContextFor } = vi.hoisted(() => ({
  accountUserId: vi.fn(),
  billingService: vi.fn(),
  startUpgrade: vi.fn(),
  upgradeContextFor: vi.fn(),
}));
vi.mock("@/lib/account", () => ({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "anon" }));
vi.mock("@/lib/puku-trial-token", () => ({ accountUserId }));
vi.mock("@/lib/billing/billing", () => ({ billingService }));
vi.mock("@/lib/billing/checkout", () => ({ startUpgrade, upgradeContextFor }));

const route = await import("./route");

function post(body: unknown, headers: Record<string, string> = { authorization: "Bearer acc" }) {
  return route.POST(
    new Request("https://weft.example/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const CTX = { service: {}, orgId: "o1", orgSlug: "acme", actorEmail: "jane@example.com", role: "owner" as const };

beforeEach(() => {
  vi.clearAllMocks();
  billingService.mockReturnValue({ svc: true });
  accountUserId.mockResolvedValue("u1");
  upgradeContextFor.mockResolvedValue(CTX);
  startUpgrade.mockResolvedValue({ ok: true, url: "https://stripe.test/c/cs_x" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/billing/checkout", () => {
  it("is 401 without a bearer token", async () => {
    const res = await post({ plan: "pro" }, {});
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "Sign in to your Weft account first." });
    expect(accountUserId).not.toHaveBeenCalled();
  });

  it("is 400 with a bad plan", async () => {
    const res = await post({ plan: "platinum" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "Pick Pro or Team, monthly or yearly." });
    expect(accountUserId).not.toHaveBeenCalled();
  });

  it("is 400 with a bad interval", async () => {
    const res = await post({ plan: "pro", interval: "weekly" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "Pick Pro or Team, monthly or yearly." });
  });

  it("is 400 when the body isn't JSON", async () => {
    const res = await post("not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "Pick Pro or Team, monthly or yearly." });
  });

  it("defaults the interval to monthly", async () => {
    const res = await post({ plan: "pro" });
    expect(res.status).toBe(200);
    expect(startUpgrade).toHaveBeenCalledWith(CTX, {
      plan: "pro",
      interval: "monthly",
      ipCountry: null,
      returnPath: "/checkout/done",
    });
  });

  it("is 503 when billingService is null (no service client)", async () => {
    billingService.mockReturnValueOnce(null);
    const res = await post({ plan: "pro" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "Billing isn't set up on this Weft." });
    expect(accountUserId).not.toHaveBeenCalled();
  });

  it("is 502 when checking the sign-in throws", async () => {
    accountUserId.mockRejectedValueOnce(new Error("supabase down"));
    const res = await post({ plan: "pro" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "Couldn't check your Weft sign-in." });
  });

  it("is 401 when the sign-in has expired", async () => {
    accountUserId.mockResolvedValueOnce(null);
    const res = await post({ plan: "pro" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "Your Weft sign-in has expired. Sign in again." });
  });

  it("is 404 when the account has no workspace", async () => {
    upgradeContextFor.mockResolvedValueOnce(null);
    const res = await post({ plan: "pro" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "No workspace for this account." });
    expect(startUpgrade).not.toHaveBeenCalled();
  });

  it("passes the visitor's country and the return path on the happy path", async () => {
    const res = await post({ plan: "team", interval: "yearly" }, { authorization: "Bearer acc", "x-vercel-ip-country": "IN" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, url: "https://stripe.test/c/cs_x" });
    expect(accountUserId).toHaveBeenCalledWith("acc", "https://x.supabase.co", "anon");
    expect(upgradeContextFor).toHaveBeenCalledWith({ svc: true }, "u1");
    expect(startUpgrade).toHaveBeenCalledWith(CTX, {
      plan: "team",
      interval: "yearly",
      ipCountry: "IN",
      returnPath: "/checkout/done",
    });
  });

  it("passes the upgrade's refusal back to the caller", async () => {
    startUpgrade.mockResolvedValueOnce({ ok: false, error: "Ask an owner to change the plan." });
    const res = await post({ plan: "pro" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: "Ask an owner to change the plan." });
  });

  it("is 502 when starting the upgrade throws", async () => {
    startUpgrade.mockRejectedValueOnce(new Error("stripe down"));
    const res = await post({ plan: "pro" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "Couldn't start checkout." });
  });

  it("is 502 when reading the workspace throws", async () => {
    upgradeContextFor.mockRejectedValueOnce(new Error("db down"));
    const res = await post({ plan: "pro" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "Couldn't start checkout." });
  });
});
