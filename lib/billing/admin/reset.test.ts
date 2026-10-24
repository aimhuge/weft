import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

// lib/billing/admin/reset.ts: clearing a workspace's billing state — the Stripe customer and
// subscription ids go, the row goes back to Free, and the old ids land in the audit row so
// nothing is lost.

const { saveSubscription } = vi.hoisted(() => ({ saveSubscription: vi.fn() }));
vi.mock("../billing", () => ({ billing: { saveSubscription } }));

import { fakeAdminStripe, fakeService, fakeStripeClient, fakeSubscriptionRow } from "./admin.harness";
import type { AdminCtx } from "./context";
import type { StripeMode } from "./stripe-keys";

async function load() {
  vi.resetModules();
  return import("./reset");
}

// An admin context on a live-mode workspace. The Stripe holder is the fake, typed so a test can
// swap its client for one that answers differently.
function ctxWith(row = fakeSubscriptionRow(), stripeClient = fakeStripeClient()) {
  const { client, calls } = fakeService({ org_subscriptions: [row] });
  const stripe = fakeAdminStripe({ live: stripeClient });
  return {
    ctx: { service: client as never, orgId: "org_1", actorEmail: "a@b.c", stripe } as AdminCtx & { stripe: typeof stripe },
    stripeClient,
    service: client,
    calls,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  saveSubscription.mockResolvedValue({});
});

describe("readReset", () => {
  it("reads both switches off by default", async () => {
    const { readReset } = await load();
    expect(readReset({})).toEqual({ cancelUpstream: false, purgeMirror: false });
  });

  it("reads both switches on", async () => {
    const { readReset } = await load();
    expect(readReset({ cancelUpstream: true, purgeMirror: true })).toEqual({ cancelUpstream: true, purgeMirror: true });
  });

  it("reads anything that isn't true as off", async () => {
    const { readReset } = await load();
    expect(readReset({ cancelUpstream: "yes", purgeMirror: 1 })).toEqual({ cancelUpstream: false, purgeMirror: false });
  });
});

describe("resetBilling", () => {
  it("clears the ids and puts the row back on Free", async () => {
    const { resetBilling } = await load();
    const { ctx, service } = ctxWith();
    const summary = await resetBilling(ctx, { cancelUpstream: false, purgeMirror: false });
    expect(saveSubscription).toHaveBeenCalledWith(service, "org_1", {
      plan: "free",
      status: "active",
      seats: 1,
      unitAmountCents: 0,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      trialEnd: null,
      provider: "mock",
      providerCustomerId: null,
      providerSubscriptionId: null,
    });
    expect(summary).toEqual({
      mode: "live",
      before: { plan: "pro", customerId: "cus_1", subscriptionId: "sub_1" },
      canceled: null,
      purged: null,
    });
  });

  it("reads a workspace with no row as Free", async () => {
    const { resetBilling } = await load();
    const { ctx } = ctxWith(fakeSubscriptionRow({ plan: "free" }));
    const summary = await resetBilling(ctx, { cancelUpstream: false, purgeMirror: false });
    expect(summary.before.plan).toBe("free");
  });

  it("reads a workspace with no row at all as Free", async () => {
    const { resetBilling } = await load();
    const { ctx } = ctxWith(null as never);
    const summary = await resetBilling(ctx, { cancelUpstream: false, purgeMirror: false });
    expect(summary.before).toEqual({ plan: "free", customerId: null, subscriptionId: null });
  });

  it("cancels the subscription in Stripe first when asked", async () => {
    const { resetBilling } = await load();
    const { ctx, stripeClient } = ctxWith();
    const summary = await resetBilling(ctx, { cancelUpstream: true, purgeMirror: false });
    expect(stripeClient.subscriptions.cancel).toHaveBeenCalledWith("sub_1");
    expect(summary.canceled).toBe("canceled");
  });

  it("lands on Free even when the subscription is already gone", async () => {
    const { resetBilling } = await load();
    const { ctx, stripeClient } = ctxWith();
    stripeClient.subscriptions.cancel.mockRejectedValue(Object.assign(new Error("no such subscription"), { code: "resource_missing" }));
    const summary = await resetBilling(ctx, { cancelUpstream: true, purgeMirror: false });
    expect(summary.canceled).toBe("already gone");
  });

  it("rethrows any other Stripe error", async () => {
    const { resetBilling } = await load();
    const { ctx, stripeClient } = ctxWith();
    stripeClient.subscriptions.cancel.mockRejectedValue(new Error("Stripe is down"));
    await expect(resetBilling(ctx, { cancelUpstream: true, purgeMirror: false })).rejects.toThrow("Stripe is down");
    expect(saveSubscription).not.toHaveBeenCalled();
  });

  it("doesn't cancel anything when there's no subscription id", async () => {
    const { resetBilling } = await load();
    const { ctx, stripeClient } = ctxWith(fakeSubscriptionRow({ provider_subscription_id: null }));
    const summary = await resetBilling(ctx, { cancelUpstream: true, purgeMirror: false });
    expect(stripeClient.subscriptions.cancel).not.toHaveBeenCalled();
    expect(summary.canceled).toBeNull();
  });

  it("doesn't cancel anything when the mode is unknown", async () => {
    const { resetBilling } = await load();
    const { ctx, stripeClient } = ctxWith();
    ctx.stripe.client = vi.fn<(mode: StripeMode) => Stripe | null>(() => null);
    ctx.stripe.modes = vi.fn<() => StripeMode[]>(() => []);
    const summary = await resetBilling(ctx, { cancelUpstream: true, purgeMirror: false });
    expect(stripeClient.subscriptions.cancel).not.toHaveBeenCalled();
    expect(summary.canceled).toBeNull();
  });

  it("says which key is missing when the mode has none", async () => {
    const { resetBilling } = await load();
    const { ctx, stripeClient } = ctxWith();
    // The mode is found (the customer lookup works), but by the time the cancel runs there's no key.
    const client = vi.fn<(mode: StripeMode) => Stripe | null>();
    client.mockReturnValueOnce(stripeClient as unknown as Stripe).mockReturnValue(null);
    ctx.stripe.client = client;
    await expect(resetBilling(ctx, { cancelUpstream: true, purgeMirror: false })).rejects.toThrow(
      /No live Stripe key to cancel the subscription with/,
    );
  });

  it("purges the mirrored invoices and cards when asked", async () => {
    const { resetBilling } = await load();
    const { ctx, calls } = ctxWith();
    const summary = await resetBilling(ctx, { cancelUpstream: false, purgeMirror: true });
    expect(summary.purged).toEqual({ invoices: 0, cards: 0 });
    const deletes = calls.filter((c) => c.op === "delete").map((c) => c.table);
    expect(deletes).toEqual(["org_invoices", "org_payment_methods"]);
  });

  it("doesn't purge anything when not asked", async () => {
    const { resetBilling } = await load();
    const { ctx, calls } = ctxWith();
    await resetBilling(ctx, { cancelUpstream: false, purgeMirror: false });
    expect(calls.filter((c) => c.op === "delete")).toEqual([]);
  });

  it("throws when the mirror can't be cleared", async () => {
    const { resetBilling } = await load();
    const { client } = fakeService(
      { org_subscriptions: [fakeSubscriptionRow()] },
      {},
      { org_invoices: { error: { message: "delete failed" } } },
    );
    const stripe = fakeAdminStripe({ live: fakeStripeClient() });
    const ctx = { service: client as never, orgId: "org_1", actorEmail: "a@b.c", stripe: stripe as never };
    await expect(resetBilling(ctx, { cancelUpstream: false, purgeMirror: true })).rejects.toThrow(
      /Couldn't clear org_invoices: delete failed/,
    );
  });

  it("puts the old ids in the audit row", async () => {
    const { resetBilling } = await load();
    const { ctx, calls } = ctxWith();
    await resetBilling(ctx, { cancelUpstream: false, purgeMirror: false });
    const insert = calls.find((c) => c.op === "insert");
    expect(insert?.table).toBe("org_billing_events");
    expect(insert?.args[0]).toEqual({
      org_id: "org_1",
      kind: "admin.billing_reset",
      actor_email: "a@b.c",
      payload: {
        mode: "live",
        before: { plan: "pro", customerId: "cus_1", subscriptionId: "sub_1" },
        canceled: null,
        purged: null,
      },
    });
  });
});
