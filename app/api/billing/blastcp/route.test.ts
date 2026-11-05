import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The deployed Weft's /api/billing/blastcp route: the tier BlastCP applies, for the person whose token it is.

const { accountUserId, billingService, blastcpAnswer } = vi.hoisted(() => ({
  accountUserId: vi.fn(),
  billingService: vi.fn(),
  blastcpAnswer: vi.fn(),
}));
vi.mock("@/lib/account", () => ({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "anon" }));
vi.mock("@/lib/puku-trial-token", () => ({ accountUserId }));
vi.mock("@/lib/billing/billing", () => ({ billingService }));
vi.mock("@/lib/billing/blastcp-bundle", () => ({ blastcpAnswer }));

const route = await import("./route");

function get(headers: Record<string, string> = {}) {
  return route.GET(new Request("https://weft.example/api/billing/blastcp", { headers }));
}
const AUTH = { authorization: "Bearer tok" };

beforeEach(() => {
  vi.clearAllMocks();
  billingService.mockReturnValue({});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/billing/blastcp", () => {
  it("is 401 without a bearer token", async () => {
    expect((await get()).status).toBe(401);
    expect(accountUserId).not.toHaveBeenCalled();
  });

  it("is 503 without the service key", async () => {
    billingService.mockReturnValue(null);
    expect((await get(AUTH)).status).toBe(503);
  });

  it("is 401 on an expired sign-in", async () => {
    accountUserId.mockResolvedValue(null);
    expect((await get(AUTH)).status).toBe(401);
    expect(blastcpAnswer).not.toHaveBeenCalled();
  });

  it("answers the tier for the token's own user", async () => {
    accountUserId.mockResolvedValue("u1");
    blastcpAnswer.mockResolvedValue({ tier: "creator", until: "2026-11-20T00:00:00.000Z" });
    const res = await get(AUTH);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tier: "creator", until: "2026-11-20T00:00:00.000Z" });
    expect(accountUserId).toHaveBeenCalledWith("tok", "https://x.supabase.co", "anon");
    expect(blastcpAnswer).toHaveBeenCalledWith({}, "u1");
  });

  it("is 502 when the plan can't be read", async () => {
    accountUserId.mockResolvedValue("u1");
    blastcpAnswer.mockRejectedValue(new Error("down"));
    expect((await get(AUTH)).status).toBe(502);
    expect(console.error).toHaveBeenCalledWith("BlastCP tier: down");
  });
});
