import { beforeEach, describe, expect, it, vi } from "vitest";

// The board's /api/account/billing/checkout route: the localhost guard, then the plan and interval it forwards
// to the deployed Weft. The guard and the billing client are mocked, so the route's own normalisation is what
// these tests pin.

const state = vi.hoisted(() => ({ denied: false }));
const { startCheckout } = vi.hoisted(() => ({ startCheckout: vi.fn() }));

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/guard", () => ({
  guard: () => (state.denied ? Response.json({ error: "Forbidden host" }, { status: 403 }) : null),
  fail: (err: unknown, status = 400) =>
    Response.json({ error: err instanceof Error ? err.message : String(err) }, { status }),
}));
vi.mock("@/lib/billing-client", () => ({ startCheckout }));

const route = await import("./route");

const WRITE = { host: "127.0.0.1:3457", "x-weft-token": "1", "content-type": "application/json" };

function post(body: unknown, headers: Record<string, string> = WRITE) {
  return route.POST(new Request("http://127.0.0.1:3457/api/account/billing/checkout", { method: "POST", headers, body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  state.denied = false;
  startCheckout.mockResolvedValue({ ok: true, url: "https://stripe.test/c/cs_x" });
});

describe("POST /api/account/billing/checkout", () => {
  it("refuses when the guard denies the request", async () => {
    state.denied = true;
    const res = await post({ plan: "pro" });
    expect(res.status).toBe(403);
    expect(startCheckout).not.toHaveBeenCalled();
  });

  it("forwards a pro monthly checkout", async () => {
    const res = await post({ plan: "pro", interval: "monthly" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, url: "https://stripe.test/c/cs_x" });
    expect(startCheckout).toHaveBeenCalledWith("pro", "monthly");
  });

  it("forwards a team yearly checkout", async () => {
    const res = await post({ plan: "team", interval: "yearly" });
    expect(res.status).toBe(200);
    expect(startCheckout).toHaveBeenCalledWith("team", "yearly");
  });

  it("normalises any plan that isn't team to pro", async () => {
    for (const plan of ["platinum", "", undefined, 42]) {
      await post({ plan, interval: "monthly" });
    }
    const plans = startCheckout.mock.calls.map((call) => call[0] as string);
    expect(plans).toEqual(["pro", "pro", "pro", "pro"]);
  });

  it("normalises any interval that isn't yearly to monthly", async () => {
    for (const interval of ["weekly", "", undefined, 42]) {
      await post({ plan: "pro", interval });
    }
    const intervals = startCheckout.mock.calls.map((call) => call[1] as string);
    expect(intervals).toEqual(["monthly", "monthly", "monthly", "monthly"]);
  });

  it("defaults a missing plan and interval to pro monthly", async () => {
    await post({});
    expect(startCheckout).toHaveBeenCalledWith("pro", "monthly");
  });

  it("passes the client's refusal back to the board", async () => {
    startCheckout.mockResolvedValueOnce({ ok: false, error: "Sign in to your Weft account first." });
    const res = await post({ plan: "pro" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: "Sign in to your Weft account first." });
  });

  it("is 400 with the message when the client throws", async () => {
    startCheckout.mockRejectedValueOnce(new Error("network down"));
    const res = await post({ plan: "pro" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "network down" });
  });

  it("is 400 when the body isn't JSON", async () => {
    const res = await route.POST(
      new Request("http://127.0.0.1:3457/api/account/billing/checkout", { method: "POST", headers: WRITE, body: "not json" }),
    );
    expect(res.status).toBe(200);
    expect(startCheckout).toHaveBeenCalledWith("pro", "monthly");
  });
});
