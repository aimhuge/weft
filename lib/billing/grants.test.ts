import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/billing/grants.ts: the $0 plans Weft grants for a year (Open Source, Education). The billing binding is
// mocked so the test pins exactly what a grant writes, and never touches Supabase or Stripe.

const { subscription, saveSubscription } = vi.hoisted(() => ({
  subscription: vi.fn(),
  saveSubscription: vi.fn(),
}));
vi.mock("./billing", () => ({ billing: { subscription, saveSubscription } }));

async function load() {
  vi.resetModules();
  return import("./grants");
}

beforeEach(() => {
  vi.clearAllMocks();
  subscription.mockResolvedValue({ plan: "free", status: "active" });
  saveSubscription.mockResolvedValue({});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const service = {} as never;
const NOW = new Date("2026-10-13T12:00:00.000Z");

describe("grantEnd", () => {
  it("adds 12 months in UTC", async () => {
    const { grantEnd, GRANT_MONTHS } = await load();
    expect(GRANT_MONTHS).toBe(12);
    expect(grantEnd(NOW)).toBe("2027-10-13T12:00:00.000Z");
  });

  it("rolls a leap day over into March (UTC, calendar-aware)", async () => {
    const { grantEnd } = await load();
    // Feb 29 2028 + 12 months is Feb 29 2029, which doesn't exist: Date rolls it to Mar 1.
    expect(grantEnd(new Date("2028-02-29T00:00:00.000Z"))).toBe("2029-03-01T00:00:00.000Z");
  });

  it("does not mutate the date it was given", async () => {
    const { grantEnd } = await load();
    const now = new Date("2026-10-13T12:00:00.000Z");
    grantEnd(now);
    expect(now.toISOString()).toBe("2026-10-13T12:00:00.000Z");
  });
});

describe("renewDue", () => {
  it("is due when the grant has no end", async () => {
    const { renewDue } = await load();
    expect(renewDue(null, NOW)).toBe(true);
  });

  it("is due when the end is missing (undefined)", async () => {
    const { renewDue } = await load();
    expect(renewDue(undefined, NOW)).toBe(true);
  });

  it("is due when the end can't be parsed", async () => {
    const { renewDue } = await load();
    expect(renewDue("not a date", NOW)).toBe(true);
  });

  it("is not due when the end is more than 30 days ahead", async () => {
    const { renewDue } = await load();
    expect(renewDue("2026-12-01T00:00:00.000Z", NOW)).toBe(false);
  });

  it("is due when the end is within 30 days", async () => {
    const { renewDue } = await load();
    expect(renewDue("2026-11-01T00:00:00.000Z", NOW)).toBe(true);
  });

  it("is due when the end is exactly 30 days ahead (the boundary counts as due)", async () => {
    const { renewDue, RENEW_WITHIN_DAYS } = await load();
    expect(RENEW_WITHIN_DAYS).toBe(30);
    expect(renewDue("2026-11-12T12:00:00.000Z", NOW)).toBe(true);
  });

  it("is due when the grant has already lapsed", async () => {
    const { renewDue } = await load();
    expect(renewDue("2026-01-01T00:00:00.000Z", NOW)).toBe(true);
  });
});

describe("grantPlan", () => {
  it("refuses a workspace on an active paid plan (pro)", async () => {
    subscription.mockResolvedValueOnce({ plan: "pro", status: "active" });
    const { grantPlan } = await load();
    expect(await grantPlan(service, "org1", "oss", NOW)).toEqual({ granted: false, reason: "paid" });
    expect(saveSubscription).not.toHaveBeenCalled();
  });

  it("refuses a workspace on an active paid plan (team)", async () => {
    subscription.mockResolvedValueOnce({ plan: "team", status: "active" });
    const { grantPlan } = await load();
    expect(await grantPlan(service, "org1", "oss", NOW)).toEqual({ granted: false, reason: "paid" });
    expect(saveSubscription).not.toHaveBeenCalled();
  });

  it("grants a free workspace", async () => {
    const { grantPlan } = await load();
    expect(await grantPlan(service, "org1", "oss", NOW)).toEqual({
      granted: true,
      plan: "oss",
      periodEnd: "2027-10-13T12:00:00.000Z",
    });
  });

  it("grants a workspace whose paid plan was canceled (the subscription is over, so it may be overwritten)", async () => {
    subscription.mockResolvedValueOnce({ plan: "pro", status: "canceled" });
    const { grantPlan } = await load();
    expect(await grantPlan(service, "org1", "edu", NOW)).toEqual({
      granted: true,
      plan: "edu",
      periodEnd: "2027-10-13T12:00:00.000Z",
    });
  });

  it("writes the grant's year to the subscription row", async () => {
    const { grantPlan } = await load();
    await grantPlan(service, "org1", "oss", NOW);
    expect(subscription).toHaveBeenCalledWith(service, "org1");
    expect(saveSubscription).toHaveBeenCalledTimes(1);
    expect(saveSubscription).toHaveBeenCalledWith(service, "org1", {
      plan: "oss",
      status: "active",
      interval: "yearly",
      seats: 1,
      unitAmountCents: 0,
      currentPeriodStart: "2026-10-13T12:00:00.000Z",
      currentPeriodEnd: "2027-10-13T12:00:00.000Z",
      cancelAtPeriodEnd: false,
      canceledAt: null,
      trialEnd: "2027-10-13T12:00:00.000Z",
    });
  });

  it("defaults to now when no date is given", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const { grantPlan } = await load();
      const outcome = await grantPlan(service, "org1", "oss");
      expect(outcome).toEqual({ granted: true, plan: "oss", periodEnd: "2027-10-13T12:00:00.000Z" });
      expect(saveSubscription).toHaveBeenCalledWith(
        service,
        "org1",
        expect.objectContaining({ currentPeriodStart: "2026-10-13T12:00:00.000Z" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
