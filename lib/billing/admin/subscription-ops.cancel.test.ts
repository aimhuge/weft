import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/billing/admin/subscription-ops.ts (part three): downgrading to Free, re-reading a
// subscription from Stripe, and comping a $0 plan by hand.

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

describe("cancelNow", () => {
  it("cancels the subscription in Stripe and puts the row back on Free", async () => {
    const { cancelNow } = await load();
    const { ctx, stripeClient, service } = ctxWith();
    expect(await cancelNow(ctx, "none")).toEqual({ stripe: "canceled" });
    expect(stripeClient.subscriptions.cancel).toHaveBeenCalledWith("sub_1", {});
    expect(saveSubscription).toHaveBeenCalledWith(
      service,
      "org_1",
      expect.objectContaining({ plan: "free", status: "active", seats: 1, unitAmountCents: 0, providerSubscriptionId: null }),
    );
  });

  it("credits the unused time when asked", async () => {
    const { cancelNow } = await load();
    const { ctx, stripeClient } = ctxWith();
    await cancelNow(ctx, "prorate");
    expect(stripeClient.subscriptions.cancel).toHaveBeenCalledWith("sub_1", { prorate: true, invoice_now: true });
  });

  it("lands on Free even when the subscription is already gone", async () => {
    const { cancelNow } = await load();
    const { ctx, stripeClient, service } = ctxWith();
    stripeClient.subscriptions.cancel.mockRejectedValue(Object.assign(new Error("no such subscription"), { code: "resource_missing" }));
    expect(await cancelNow(ctx, "none")).toEqual({ stripe: "already gone" });
    expect(saveSubscription).toHaveBeenCalledWith(service, "org_1", expect.objectContaining({ plan: "free" }));
  });

  it("rethrows any other Stripe error", async () => {
    const { cancelNow } = await load();
    const { ctx, stripeClient } = ctxWith();
    stripeClient.subscriptions.cancel.mockRejectedValue(new Error("Stripe is down"));
    await expect(cancelNow(ctx, "none")).rejects.toThrow("Stripe is down");
    expect(saveSubscription).not.toHaveBeenCalled();
  });

  it("refuses a workspace with no subscription", async () => {
    const { cancelNow } = await load();
    const { ctx } = ctxWith(fakeSubscriptionRow({ provider_subscription_id: null }));
    await expect(cancelNow(ctx, "none")).rejects.toThrow(/No Stripe subscription/);
  });
});

describe("resync", () => {
  it("mirrors a live subscription again", async () => {
    const { resync } = await load();
    const { ctx, stripeClient } = ctxWith();
    stripeClient.subscriptions.retrieve.mockResolvedValue(fakeSubscription());
    await resync(ctx);
    expect(saveSubscription).toHaveBeenCalled();
  });

  it("puts a canceled subscription back on Free", async () => {
    const { resync } = await load();
    const { ctx, stripeClient, service } = ctxWith();
    stripeClient.subscriptions.retrieve.mockResolvedValue(
      fakeSubscription({ status: "canceled", canceled_at: 1_767_000_000 }),
    );
    await resync(ctx);
    expect(saveSubscription).toHaveBeenCalledWith(
      service,
      "org_1",
      expect.objectContaining({ plan: "free", canceledAt: "2025-12-29T09:20:00.000Z" }),
    );
  });
});

describe("compPlan", () => {
  it("refuses a paid plan", async () => {
    const { compPlan } = await load();
    const { ctx } = ctxWith();
    await expect(compPlan(ctx, "pro")).rejects.toThrow(/paid plans go through Stripe/);
  });

  it("refuses a plan that isn't a comp plan", async () => {
    const { compPlan } = await load();
    const { ctx } = ctxWith();
    await expect(compPlan(ctx, "team")).rejects.toThrow(/Comp one of/);
  });

  it("refuses a workspace with a live subscription", async () => {
    const { compPlan } = await load();
    const { ctx } = ctxWith();
    subscription.mockResolvedValue({ plan: "pro", status: "active", providerSubscriptionId: "sub_1" });
    await expect(compPlan(ctx, "oss")).rejects.toThrow(/has a Stripe subscription/);
    expect(grantPlan).not.toHaveBeenCalled();
  });

  it("comps a canceled workspace", async () => {
    const { compPlan } = await load();
    const { ctx } = ctxWith();
    subscription.mockResolvedValue({ plan: "pro", status: "canceled", providerSubscriptionId: "sub_1" });
    await compPlan(ctx, "oss");
    expect(grantPlan).toHaveBeenCalledWith(expect.anything(), "org_1", "oss");
  });

  it("grants Free through the admin path, not the grant", async () => {
    const { compPlan } = await load();
    const { ctx, service } = ctxWith();
    subscription.mockResolvedValue({ plan: "oss", status: "active", providerSubscriptionId: null });
    await compPlan(ctx, "free");
    expect(setPlanByAdmin).toHaveBeenCalledWith(service, { orgId: "org_1", plan: "free", actorEmail: "a@b.c" });
    expect(grantPlan).not.toHaveBeenCalled();
  });

  it("grants Education through the grant", async () => {
    const { compPlan } = await load();
    const { ctx } = ctxWith();
    subscription.mockResolvedValue({ plan: "free", status: "active", providerSubscriptionId: null });
    await compPlan(ctx, "edu");
    expect(grantPlan).toHaveBeenCalledWith(expect.anything(), "org_1", "edu");
    expect(setPlanByAdmin).not.toHaveBeenCalled();
  });
});
