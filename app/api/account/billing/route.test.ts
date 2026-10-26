import { beforeEach, describe, expect, it, vi } from "vitest";

// The local /api/account/billing route: localhost guard, then the billing client. The sibling test
// app/api/account-routes.test.ts is the closest pattern.

vi.mock("next/server", () => ({ connection: async () => {} }));
const { fetchBillingStatus } = vi.hoisted(() => ({ fetchBillingStatus: vi.fn() }));
vi.mock("@/lib/billing-client", () => ({ fetchBillingStatus }));
const notePlan = vi.hoisted(() => vi.fn());
vi.mock("@/lib/blastcp-plan", () => ({ notePlan }));

const route = await import("./route");

function get(headers: Record<string, string> = { host: "127.0.0.1:3457" }) {
  return route.GET(new Request("http://127.0.0.1:3457/api/account/billing", { method: "GET", headers }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/account/billing", () => {
  it("tells the BlastCP nudge which plan it saw", async () => {
    fetchBillingStatus.mockResolvedValueOnce({ plan: { id: "team", name: "Team" } });
    await get();
    expect(notePlan).toHaveBeenCalledWith("team");
    fetchBillingStatus.mockResolvedValueOnce(null);
    await get();
    expect(notePlan).toHaveBeenLastCalledWith(null);
  });

  it("refuses other hosts", async () => {
    const res = await get({ host: "evil.com" });
    expect(res.status).toBe(403);
    expect(fetchBillingStatus).not.toHaveBeenCalled();
  });

  it("returns the billing client's result on the happy path (signed in)", async () => {
    fetchBillingStatus.mockResolvedValueOnce({ plan: "pro" });
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plan: "pro" });
  });

  it("passes through null when the user is signed out (the section hides itself)", async () => {
    fetchBillingStatus.mockResolvedValueOnce(null);
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("passes through an { error } object as 200 so the client renders the message", async () => {
    fetchBillingStatus.mockResolvedValueOnce({ error: "Weft's billing answered 503." });
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ error: "Weft's billing answered 503." });
  });

  it("is 400 with the message when the billing client throws", async () => {
    fetchBillingStatus.mockRejectedValueOnce(new Error("network down"));
    const res = await get();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "network down" });
  });
});
