import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/billing/admin/refunds.ts: the workspace's charges as Stripe has them, and a full or partial
// refund of one. A charge is refunded only when it belongs to the workspace's own customer, and
// never for more than is left on it.

import { fakeAdminStripe, fakeCharge, fakeService, fakeStripeClient, fakeSubscriptionRow } from "./admin.harness";

async function load() {
  vi.resetModules();
  return import("./refunds");
}

// An admin context on a live-mode workspace whose customer is cus_1.
function ctxWith(stripeClient = fakeStripeClient(), row = fakeSubscriptionRow()) {
  const { client } = fakeService({ org_subscriptions: [row] });
  const stripe = fakeAdminStripe({ live: stripeClient });
  return {
    ctx: { service: client as never, orgId: "org_1", actorEmail: "a@b.c", stripe: stripe as never },
    stripeClient,
    service: client,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("toChargeView", () => {
  it("reads a charge into the view the console shows", async () => {
    const { toChargeView } = await load();
    expect(toChargeView(fakeCharge() as never)).toEqual({
      id: "ch_1",
      amountCents: 5000,
      refundedCents: 0,
      refundableCents: 5000,
      currency: "usd",
      status: "succeeded",
      description: "Pro, monthly",
      createdAt: "2025-10-09T08:53:20.000Z",
      receiptUrl: "https://pay.stripe.com/receipts/ch_1",
    });
  });

  it("reads a refunded charge as refunded", async () => {
    const { toChargeView } = await load();
    const view = toChargeView(fakeCharge({ refunded: true, amount_refunded: 5000 }) as never);
    expect(view.status).toBe("refunded");
    expect(view.refundedCents).toBe(5000);
    expect(view.refundableCents).toBe(0);
  });

  it("leaves what's left on a partly refunded charge", async () => {
    const { toChargeView } = await load();
    const view = toChargeView(fakeCharge({ amount_refunded: 2000 }) as never);
    expect(view.refundableCents).toBe(3000);
  });

  it("has nothing to refund on a failed charge", async () => {
    const { toChargeView } = await load();
    const view = toChargeView(fakeCharge({ status: "failed" }) as never);
    expect(view.refundableCents).toBe(0);
    expect(view.status).toBe("failed");
  });

  it("never goes below zero", async () => {
    const { toChargeView } = await load();
    expect(toChargeView(fakeCharge({ amount_refunded: 9000 }) as never).refundableCents).toBe(0);
  });

  it("has no receipt when Stripe gave none", async () => {
    const { toChargeView } = await load();
    expect(toChargeView(fakeCharge({ receipt_url: null }) as never).receiptUrl).toBeNull();
  });
});

describe("listCharges", () => {
  it("lists the workspace's charges", async () => {
    const { listCharges } = await load();
    const { ctx, stripeClient } = ctxWith();
    stripeClient.charges.list.mockResolvedValue({ data: [fakeCharge()] });
    expect(await listCharges(ctx)).toHaveLength(1);
    expect(stripeClient.charges.list).toHaveBeenCalledWith({ customer: "cus_1", limit: 24 });
  });

  it("lists nothing when the workspace has no customer", async () => {
    const { listCharges } = await load();
    const { ctx, stripeClient } = ctxWith(fakeStripeClient(), fakeSubscriptionRow({ provider_customer_id: null }));
    expect(await listCharges(ctx)).toEqual([]);
    expect(stripeClient.charges.list).not.toHaveBeenCalled();
  });
});

describe("readRefund", () => {
  it("reads a full refund, with a default reason", async () => {
    const { readRefund } = await load();
    expect(readRefund({ chargeId: "ch_1" })).toEqual({ chargeId: "ch_1", reason: "requested_by_customer" });
  });

  it("reads a partial refund", async () => {
    const { readRefund } = await load();
    expect(readRefund({ chargeId: "ch_1", amountCents: 500, reason: "duplicate" })).toEqual({
      chargeId: "ch_1",
      amountCents: 500,
      reason: "duplicate",
    });
  });

  it("reads a full refund when the amount is empty", async () => {
    const { readRefund } = await load();
    expect(readRefund({ chargeId: "ch_1", amountCents: "" })).toEqual({ chargeId: "ch_1", reason: "requested_by_customer" });
    expect(readRefund({ chargeId: "ch_1", amountCents: null })).toEqual({ chargeId: "ch_1", reason: "requested_by_customer" });
  });

  it("refuses a charge id that isn't one", async () => {
    const { readRefund } = await load();
    expect(() => readRefund({ chargeId: "sub_1" })).toThrow(/Pick a charge to refund/);
    expect(() => readRefund({})).toThrow(/Pick a charge to refund/);
  });

  it("accepts a payment intent id", async () => {
    const { readRefund } = await load();
    expect(readRefund({ chargeId: "py_1" }).chargeId).toBe("py_1");
  });

  it("refuses an unknown reason", async () => {
    const { readRefund } = await load();
    expect(() => readRefund({ chargeId: "ch_1", reason: "because" })).toThrow(/Reason must be one of/);
  });

  it("refuses a partial amount that isn't a whole number of cents", async () => {
    const { readRefund } = await load();
    expect(() => readRefund({ chargeId: "ch_1", amountCents: 12.5 })).toThrow(/whole number of cents/);
    expect(() => readRefund({ chargeId: "ch_1", amountCents: 0 })).toThrow(/whole number of cents/);
    expect(() => readRefund({ chargeId: "ch_1", amountCents: -5 })).toThrow(/whole number of cents/);
  });
});

describe("refundCharge", () => {
  it("refunds everything left on a charge", async () => {
    const { refundCharge } = await load();
    const { ctx, stripeClient } = ctxWith();
    stripeClient.charges.retrieve.mockResolvedValue(fakeCharge());
    stripeClient.refunds.create.mockResolvedValue({ id: "re_1" });
    expect(await refundCharge(ctx, { chargeId: "ch_1", reason: "requested_by_customer" })).toEqual({
      refundId: "re_1",
      amountCents: 5000,
    });
    expect(stripeClient.refunds.create).toHaveBeenCalledWith(
      { charge: "ch_1", amount: 5000, reason: "requested_by_customer", metadata: { app: "weft", org_id: "org_1", actor: "a@b.c" } },
      { idempotencyKey: "admin-refund:ch_1:5000:0" },
    );
  });

  it("refunds part of a charge", async () => {
    const { refundCharge } = await load();
    const { ctx, stripeClient } = ctxWith();
    stripeClient.charges.retrieve.mockResolvedValue(fakeCharge());
    stripeClient.refunds.create.mockResolvedValue({ id: "re_2" });
    expect(await refundCharge(ctx, { chargeId: "ch_1", amountCents: 1000, reason: "duplicate" })).toEqual({
      refundId: "re_2",
      amountCents: 1000,
    });
    expect(stripeClient.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1000 }),
      { idempotencyKey: "admin-refund:ch_1:1000:0" },
    );
  });

  it("refuses a charge that isn't this workspace's", async () => {
    const { refundCharge } = await load();
    const { ctx, stripeClient } = ctxWith();
    stripeClient.charges.retrieve.mockResolvedValue(fakeCharge({ customer: "cus_other" }));
    await expect(refundCharge(ctx, { chargeId: "ch_1", reason: "requested_by_customer" })).rejects.toThrow(
      /isn't this workspace's/,
    );
    expect(stripeClient.refunds.create).not.toHaveBeenCalled();
  });

  it("refuses a charge with no customer at all", async () => {
    const { refundCharge } = await load();
    const { ctx, stripeClient } = ctxWith();
    stripeClient.charges.retrieve.mockResolvedValue(fakeCharge({ customer: null }));
    await expect(refundCharge(ctx, { chargeId: "ch_1", reason: "requested_by_customer" })).rejects.toThrow(
      /isn't this workspace's/,
    );
  });

  it("reads an expanded customer as its id", async () => {
    const { refundCharge } = await load();
    const { ctx, stripeClient } = ctxWith();
    stripeClient.charges.retrieve.mockResolvedValue(fakeCharge({ customer: { id: "cus_1" } }));
    stripeClient.refunds.create.mockResolvedValue({ id: "re_1" });
    expect((await refundCharge(ctx, { chargeId: "ch_1", reason: "duplicate" })).amountCents).toBe(5000);
  });

  it("refuses a charge with nothing left on it", async () => {
    const { refundCharge } = await load();
    const { ctx, stripeClient } = ctxWith();
    stripeClient.charges.retrieve.mockResolvedValue(fakeCharge({ refunded: true, amount_refunded: 5000 }));
    await expect(refundCharge(ctx, { chargeId: "ch_1", reason: "requested_by_customer" })).rejects.toThrow(
      /Nothing is left to refund/,
    );
  });

  it("refuses more than is left on the charge", async () => {
    const { refundCharge } = await load();
    const { ctx, stripeClient } = ctxWith();
    stripeClient.charges.retrieve.mockResolvedValue(fakeCharge({ amount_refunded: 2000 }));
    await expect(
      refundCharge(ctx, { chargeId: "ch_1", amountCents: 4000, reason: "requested_by_customer" }),
    ).rejects.toThrow(/At most 3000 cents is left/);
  });
});
