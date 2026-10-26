import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/billing/seats.ts: Team's Stripe quantity follows the roster. billing is mocked so the test pins which rows move,
// which don't (not Team, not billing, another provider's row), and that the quiet wrapper never throws.

const { subscription, changePlan, provider } = vi.hoisted(() => {
  const changePlan = vi.fn();
  const provider = { id: "stripe", changePlan };
  return { subscription: vi.fn(), changePlan, provider };
});
vi.mock("./billing", () => ({ billing: { subscription, provider: () => provider } }));

import { syncTeamSeats, syncTeamSeatsQuietly } from "./seats";

const ORG = { id: "o1", slug: "acme" };
const TEAM = { plan: "team", status: "active", interval: "monthly", seats: 2, provider: "stripe" };

// The members count read: `select(..., { count: "exact", head: true }).eq("org_id", id)`.
function service(count: number | null, error: { message: string } | null = null) {
  const eq = vi.fn(() => Promise.resolve({ count, error }));
  const select = vi.fn(() => ({ eq }));
  return { client: { from: vi.fn(() => ({ select })) } as never, eq };
}

beforeEach(() => {
  vi.clearAllMocks();
  provider.id = "stripe";
  changePlan.mockResolvedValue({});
});

describe("syncTeamSeats", () => {
  it("raises a Team subscription's quantity when someone joins", async () => {
    subscription.mockResolvedValue(TEAM);
    const svc = service(3);
    expect(await syncTeamSeats(svc.client, ORG, "jane@example.com")).toBe(3);
    expect(svc.eq).toHaveBeenCalledWith("org_id", "o1");
    expect(changePlan).toHaveBeenCalledWith(
      { service: svc.client, orgId: "o1", orgSlug: "acme", actorEmail: "jane@example.com" },
      { plan: "team", interval: "monthly", seats: 3 },
    );
  });

  it("lowers it when someone leaves, keeping the interval", async () => {
    subscription.mockResolvedValue({ ...TEAM, seats: 4, interval: "yearly" });
    await syncTeamSeats(service(3).client, ORG, null);
    expect(changePlan).toHaveBeenCalledWith(expect.anything(), { plan: "team", interval: "yearly", seats: 3 });
  });

  it("leaves a quantity that already matches", async () => {
    subscription.mockResolvedValue(TEAM);
    expect(await syncTeamSeats(service(2).client, ORG, null)).toBe(2);
    expect(changePlan).not.toHaveBeenCalled();
  });

  it("never bills fewer than one seat", async () => {
    subscription.mockResolvedValue(TEAM);
    expect(await syncTeamSeats(service(null).client, ORG, null)).toBe(1);
    expect(changePlan).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ seats: 1 }));
  });

  it("still follows the roster while a payment is failing", async () => {
    subscription.mockResolvedValue({ ...TEAM, status: "past_due" });
    expect(await syncTeamSeats(service(3).client, ORG, null)).toBe(3);
  });

  it.each([
    ["Pro, billed per workspace", { ...TEAM, plan: "pro" }],
    ["Free", { ...TEAM, plan: "free" }],
    ["a canceled Team", { ...TEAM, status: "canceled" }],
    ["an incomplete Team", { ...TEAM, status: "incomplete" }],
  ])("moves nothing on %s", async (_label, sub) => {
    subscription.mockResolvedValue(sub);
    const svc = service(5);
    expect(await syncTeamSeats(svc.client, ORG, null)).toBeNull();
    expect(svc.eq).not.toHaveBeenCalled();
    expect(changePlan).not.toHaveBeenCalled();
  });

  it("leaves a Stripe row alone from a local run on the mock", async () => {
    // Local Weft shares the production database with BILLING_PROVIDER unset.
    provider.id = "mock";
    subscription.mockResolvedValue(TEAM);
    expect(await syncTeamSeats(service(5).client, ORG, null)).toBeNull();
    expect(changePlan).not.toHaveBeenCalled();
  });

  it("throws when the roster can't be read", async () => {
    subscription.mockResolvedValue(TEAM);
    await expect(syncTeamSeats(service(null, { message: "down" }).client, ORG, null)).rejects.toThrow("down");
  });
});

describe("syncTeamSeatsQuietly", () => {
  it("logs a failed change instead of undoing the membership", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    subscription.mockResolvedValue(TEAM);
    changePlan.mockRejectedValue(new Error("card declined"));
    await expect(syncTeamSeatsQuietly(service(3).client, ORG, null)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("Team seats: acme: card declined");
    log.mockRestore();
  });

  it("names a non-Error failure as unknown", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    subscription.mockRejectedValue("nope");
    await syncTeamSeatsQuietly(service(3).client, ORG, null);
    expect(log).toHaveBeenCalledWith("Team seats: acme: unknown");
    log.mockRestore();
  });

  it("does the sync when nothing fails", async () => {
    subscription.mockResolvedValue(TEAM);
    await syncTeamSeatsQuietly(service(3).client, ORG, null);
    expect(changePlan).toHaveBeenCalledTimes(1);
  });
});
