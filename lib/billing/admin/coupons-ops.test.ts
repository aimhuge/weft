import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/billing/admin/coupons.ts, the half that writes: making a code, turning one on or off, and putting a
// discount on (or taking it off) a workspace's live subscription. The context module (the org's Stripe client
// and the audit trail) is mocked, so the test pins exactly what is asked of Stripe and what is written down.

const { audit, orgStripe } = vi.hoisted(() => ({
  audit: vi.fn(),
  orgStripe: vi.fn(),
}));

vi.mock("./context", () => ({ audit, orgStripe }));

// AdminBillingError stays real: the refusals it carries are part of the contract.
vi.mock("./stripe-keys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stripe-keys")>();
  return { ...actual, adminStripe: vi.fn(() => null) };
});

import { fakeCouponStripe, fakePromoCode } from "./coupons.harness";
import { applyCoupon, createCoupon, removeDiscount, setPromotionActive } from "./coupons";

const client = fakeCouponStripe();

const CTX = { service: { svc: true }, orgId: "org_1", actorEmail: "ada@b.co", stripe: {} } as never;

beforeEach(() => {
  vi.clearAllMocks();
  client.promotionCodes.list.mockResolvedValue({ data: [] });
  client.promotionCodes.create.mockResolvedValue(fakePromoCode());
  client.promotionCodes.update.mockResolvedValue(fakePromoCode());
  client.coupons.create.mockResolvedValue({ id: "cou_1" });
  client.subscriptions.update.mockResolvedValue({});
  audit.mockResolvedValue(undefined);
});

describe("createCoupon", () => {
  it("refuses a code that's already active", async () => {
    client.promotionCodes.list.mockResolvedValue({ data: [fakePromoCode()] });
    const input = { code: "SAVE20", name: "SAVE20", percentOff: 20, amountOffCents: null, duration: "once" as const, durationMonths: null, maxRedemptions: null, expiresAt: null, firstTimeOnly: false };
    await expect(createCoupon(client as never, input, "ada@b.co")).rejects.toThrow(/already an active code/);
    expect(client.coupons.create).not.toHaveBeenCalled();
  });

  it("makes a percent-off coupon", async () => {
    await createCoupon(client as never, { code: "SAVE20", name: "SAVE20", percentOff: 20, amountOffCents: null, duration: "once", durationMonths: null, maxRedemptions: null, expiresAt: null, firstTimeOnly: false }, "ada@b.co");
    expect(client.coupons.create).toHaveBeenCalledWith({
      name: "SAVE20",
      percent_off: 20,
      duration: "once",
      metadata: { app: "weft", kind: "coupon", created_by: "ada@b.co" },
    });
  });

  it("makes an amount-off coupon in dollars", async () => {
    await createCoupon(client as never, { code: "TENOFF", name: "TENOFF", percentOff: null, amountOffCents: 1000, duration: "once", durationMonths: null, maxRedemptions: null, expiresAt: null, firstTimeOnly: false }, "ada@b.co");
    expect(client.coupons.create).toHaveBeenCalledWith({
      name: "TENOFF",
      amount_off: 1000,
      currency: "usd",
      duration: "once",
      metadata: { app: "weft", kind: "coupon", created_by: "ada@b.co" },
    });
  });

  it("carries the months on a repeating coupon", async () => {
    await createCoupon(client as never, { code: "REPEAT", name: "REPEAT", percentOff: 10, amountOffCents: null, duration: "repeating", durationMonths: 3, maxRedemptions: null, expiresAt: null, firstTimeOnly: false }, "ada@b.co");
    expect(client.coupons.create).toHaveBeenCalledWith(expect.objectContaining({ duration: "repeating", duration_in_months: 3 }));
  });

  it("puts the max redemptions, the expiry and first-time-only on the promotion code", async () => {
    await createCoupon(client as never, { code: "LIMITED", name: "LIMITED", percentOff: 10, amountOffCents: null, duration: "once", durationMonths: null, maxRedemptions: 50, expiresAt: 1798761600, firstTimeOnly: true }, "ada@b.co");
    expect(client.promotionCodes.create).toHaveBeenCalledWith({
      promotion: { type: "coupon", coupon: "cou_1" },
      code: "LIMITED",
      max_redemptions: 50,
      expires_at: 1798761600,
      restrictions: { first_time_transaction: true },
      metadata: { app: "weft", kind: "coupon", created_by: "ada@b.co" },
      expand: ["promotion.coupon"],
    });
  });

  it("leaves out the optional fields it wasn't given", async () => {
    await createCoupon(client as never, { code: "PLAIN", name: "PLAIN", percentOff: 10, amountOffCents: null, duration: "once", durationMonths: null, maxRedemptions: null, expiresAt: null, firstTimeOnly: false }, "ada@b.co");
    const arg = client.promotionCodes.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.max_redemptions).toBeUndefined();
    expect(arg.expires_at).toBeUndefined();
    expect(arg.restrictions).toBeUndefined();
  });

  it("adds the extra metadata it was handed", async () => {
    await createCoupon(client as never, { code: "PLAIN", name: "PLAIN", percentOff: 10, amountOffCents: null, duration: "once", durationMonths: null, maxRedemptions: null, expiresAt: null, firstTimeOnly: false }, "ada@b.co", { campaign: "launch" });
    expect(client.coupons.create).toHaveBeenCalledWith(expect.objectContaining({ metadata: { app: "weft", kind: "coupon", created_by: "ada@b.co", campaign: "launch" } }));
  });

  it("answers the code's view", async () => {
    const view = await createCoupon(client as never, { code: "SAVE20", name: "SAVE20", percentOff: 20, amountOffCents: null, duration: "once", durationMonths: null, maxRedemptions: null, expiresAt: null, firstTimeOnly: false }, "ada@b.co");
    expect(view.code).toBe("SAVE20");
    expect(view.couponId).toBe("cou_1");
  });
});

describe("setPromotionActive", () => {
  it("turns a code off", async () => {
    client.promotionCodes.update.mockResolvedValue(fakePromoCode({ active: false }));
    const view = await setPromotionActive(client as never, "promo_1", false);
    expect(client.promotionCodes.update).toHaveBeenCalledWith("promo_1", { active: false, expand: ["promotion.coupon"] });
    expect(view.active).toBe(false);
  });

  it("turns a code on", async () => {
    await setPromotionActive(client as never, "promo_1", true);
    expect(client.promotionCodes.update).toHaveBeenCalledWith("promo_1", { active: true, expand: ["promotion.coupon"] });
  });

  it("refuses an id that isn't a promotion code", async () => {
    await expect(setPromotionActive(client as never, "nope", true)).rejects.toThrow(/Pick a promotion code/);
    expect(client.promotionCodes.update).not.toHaveBeenCalled();
  });
});

describe("applyCoupon", () => {
  it("puts the discount on the workspace's subscription and audits it", async () => {
    orgStripe.mockResolvedValue({ client, row: { provider_subscription_id: "sub_1" }, mode: { mode: "live" } });
    client.promotionCodes.list.mockResolvedValue({ data: [fakePromoCode()] });
    await applyCoupon(CTX, " SAVE20 ");
    expect(client.subscriptions.update).toHaveBeenCalledWith("sub_1", { discounts: [{ promotion_code: "promo_1" }] });
    expect(audit).toHaveBeenCalledWith(CTX, "coupon_apply", { mode: "live", subscription: "sub_1", code: "SAVE20", promotion: "promo_1" });
  });

  it("refuses when the workspace has no subscription", async () => {
    orgStripe.mockResolvedValue({ client, row: null, mode: { mode: "live" } });
    await expect(applyCoupon(CTX, "SAVE20")).rejects.toThrow(/No subscription to discount/);
  });

  it("refuses a code that isn't active in that mode", async () => {
    orgStripe.mockResolvedValue({ client, row: { provider_subscription_id: "sub_1" }, mode: { mode: "test" } });
    client.promotionCodes.list.mockResolvedValue({ data: [] });
    await expect(applyCoupon(CTX, "SAVE20")).rejects.toThrow(/No active promotion code SAVE20 in test mode/);
  });
});

describe("removeDiscount", () => {
  it("takes the discount off and audits it", async () => {
    orgStripe.mockResolvedValue({ client, row: { provider_subscription_id: "sub_1" }, mode: { mode: "live" } });
    await removeDiscount(CTX);
    expect(client.subscriptions.update).toHaveBeenCalledWith("sub_1", { discounts: "" });
    expect(audit).toHaveBeenCalledWith(CTX, "coupon_remove", { mode: "live", subscription: "sub_1" });
  });

  it("refuses when the workspace has no subscription", async () => {
    orgStripe.mockResolvedValue({ client, row: { provider_subscription_id: null }, mode: { mode: "live" } });
    await expect(removeDiscount(CTX)).rejects.toThrow(/No subscription to take a discount off/);
  });
});
