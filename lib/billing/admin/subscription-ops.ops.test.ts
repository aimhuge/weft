import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/billing/admin/subscription-ops.ts (part two): the ops that talk to Stripe — changing the plan
// or the seat count, cancelling, resuming, re-reading and comping. The billing binding and the
// grant are mocked, so the test pins exactly what the console writes.

const { saveSubscription, subscription, setPlanByAdmin } = vi.hoisted(() => ({
  saveSubscription: vi.fn(),
  subscription: vi.fn(),
  setPlanByAdmin: vi.fn(),
}));
vi.mock("../billing", () => ({ billing: { saveSubscription, subscription, setPlanByAdmin } }));
const { grantPlan } = vi.hoisted(() => ({ grantPlan: vi.fn() }));
vi.mock("../grants", () => ({ grantPlan }));

import { fakeAdminStripe, fakeService, fakeStripeClient, fakeSubscription, fakeSubscriptionRow } from "./admin.harness";

async function load() {
  vi.resetModules();
  return import("./subscription-ops");
}

beforeEach(() => {
  vi.clearAllMocks();
  saveSubscription.mockResolvedValue({});
  subscription.mockResolvedValue({ plan: "free", status: "active", providerSubscriptionId: null });
  setPlanByAdmin.mockResolvedValue({});
  grantPlan.mockResolvedValue({ granted: true });
});

// An admin context on a live-mode workspace with a Stripe subscription.
function ctxWith(row = fakeSubscriptionRow(), stripeClient = fakeStripeClient()) {
  const { client } = fakeService({ org_subscriptions: [row] });
  const stripe = fakeAdminStripe({ live: stripeClient });
  return {
    ctx: { service: client as never, orgId: "org_1", actorEmail: "a@b.c", stripe: stripe as never },
    stripeClient,
    service: client,
  };
}

describe("readChange", () => {
  it("reads a change as given", async () => {
    const { readChange } = await load();
    expect(readChange({ plan: "team", interval: "yearly", seats: 4, proration: "none" })).toEqual({
      plan: "team",
      interval: "yearly",
      seats: 4,
      proration: "none",
    });
  });

  it("defaults the seats to one and the proration to create_prorations", async () => {
    const { readChange } = await load();
    expect(readChange({ plan: "team", interval: "monthly" })).toEqual({
      plan: "team",
      interval: "monthly",
      seats: 1,
      proration: "create_prorations",
    });
  });

  it("forces Pro to one seat", async () => {
    const { readChange } = await load();
    expect(readChange({ plan: "pro", interval: "monthly", seats: 9 }).seats).toBe(1);
  });

  it("refuses a plan Weft doesn't sell", async () => {
    const { readChange } = await load();
    expect(() => readChange({ plan: "free", interval: "monthly" })).toThrow(/Plan must be one of/);
  });

  it("refuses an unknown plan", async () => {
    const { readChange } = await load();
    expect(() => readChange({ plan: "enterprise", interval: "monthly" })).toThrow(/Plan must be one of/);
  });

  it("refuses an unknown interval", async () => {
    const { readChange } = await load();
    expect(() => readChange({ plan: "pro", interval: "weekly" })).toThrow(/Interval must be/);
  });

  it("refuses a seat count that isn't a whole number", async () => {
    const { readChange } = await load();
    expect(() => readChange({ plan: "team", interval: "monthly", seats: 1.5 })).toThrow(/whole number from 1 to 500/);
  });

  it("refuses zero seats", async () => {
    const { readChange } = await load();
    expect(() => readChange({ plan: "team", interval: "monthly", seats: 0 })).toThrow(/whole number from 1 to 500/);
  });

  it("refuses more than 500 seats", async () => {
    const { readChange } = await load();
    expect(() => readChange({ plan: "team", interval: "monthly", seats: 501 })).toThrow(/whole number from 1 to 500/);
  });

  it("refuses an unknown proration", async () => {
    const { readChange } = await load();
    expect(() => readChange({ plan: "team", interval: "monthly", proration: "whenever" })).toThrow(/Proration must be one of/);
  });
});

describe("changeSubscription", () => {
  it("swaps the item's price and quantity, and mirrors the answer", async () => {
    const { changeSubscription } = await load();
    const { ctx, stripeClient } = ctxWith();
    stripeClient.prices.list.mockResolvedValue({ data: [{ id: "price_team" }] });
    stripeClient.subscriptions.update.mockResolvedValue(fakeSubscription());
    await changeSubscription(ctx, { plan: "team", interval: "monthly", seats: 5, proration: "create_prorations" });
    expect(stripeClient.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      items: [{ id: "si_1", price: "price_team", quantity: 5 }],
      proration_behavior: "create_prorations",
      cancel_at_period_end: false,
    });
    expect(saveSubscription).toHaveBeenCalled();
  });

  it("refuses a subscription with no item", async () => {
    const { changeSubscription } = await load();
    const { ctx, stripeClient } = ctxWith();
    stripeClient.prices.list.mockResolvedValue({ data: [{ id: "price_team" }] });
    stripeClient.subscriptions.retrieve.mockResolvedValue({ ...fakeSubscription(), items: { data: [] } });
    await expect(
      changeSubscription(ctx, { plan: "team", interval: "monthly", seats: 1, proration: "none" }),
    ).rejects.toThrow(/has no item to change/);
  });

  it("refuses a workspace with no subscription", async () => {
    const { changeSubscription } = await load();
    const { ctx } = ctxWith(fakeSubscriptionRow({ provider_subscription_id: null }));
    await expect(
      changeSubscription(ctx, { plan: "team", interval: "monthly", seats: 1, proration: "none" }),
    ).rejects.toThrow(/No Stripe subscription/);
  });
});

describe("setCancelAtPeriodEnd", () => {
  it("sets cancel_at_period_end and mirrors", async () => {
    const { setCancelAtPeriodEnd } = await load();
    const { ctx, stripeClient } = ctxWith();
    stripeClient.subscriptions.update.mockResolvedValue(fakeSubscription({ cancel_at_period_end: true }));
    await setCancelAtPeriodEnd(ctx, true);
    expect(stripeClient.subscriptions.update).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: true });
    expect(saveSubscription).toHaveBeenCalled();
  });

  it("resumes a subscription canceled at period end", async () => {
    const { setCancelAtPeriodEnd } = await load();
    const { ctx, stripeClient } = ctxWith();
    stripeClient.subscriptions.update.mockResolvedValue(fakeSubscription());
    await setCancelAtPeriodEnd(ctx, false);
    expect(stripeClient.subscriptions.update).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: false });
  });
});
