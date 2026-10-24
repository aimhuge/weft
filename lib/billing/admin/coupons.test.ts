import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/billing/admin/coupons.ts: the promotion codes Weft's Stripe account holds. A coupon is the discount, a
// promotion code is the word typed at Checkout. The context module (the org's Stripe client and the audit
// trail) is mocked, so the test pins exactly what is asked of Stripe and what is written down.

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
import { findPromotionCode, listCoupons, readCoupon, toCouponView } from "./coupons";

const client = fakeCouponStripe();

beforeEach(() => {
  vi.clearAllMocks();
  client.promotionCodes.list.mockResolvedValue({ data: [] });
  client.promotionCodes.create.mockResolvedValue(fakePromoCode());
  client.promotionCodes.update.mockResolvedValue(fakePromoCode());
  client.coupons.create.mockResolvedValue({ id: "cou_1" });
});

describe("toCouponView", () => {
  it("reads the coupon out of an expanded promotion code", () => {
    const view = toCouponView(fakePromoCode() as never);
    expect(view).toEqual({
      promotionId: "promo_1",
      code: "SAVE20",
      active: true,
      couponId: "cou_1",
      name: "Save 20",
      percentOff: 20,
      amountOffCents: null,
      duration: "once",
      durationMonths: null,
      timesRedeemed: 0,
      maxRedemptions: null,
      expiresAt: null,
      kind: "coupon",
      referrerOrgId: null,
    });
  });

  it("falls back to the coupon id when the coupon isn't expanded", () => {
    const view = toCouponView(fakePromoCode({ promotion: { type: "coupon", coupon: "cou_9" } }) as never);
    expect(view.couponId).toBe("cou_9");
    expect(view.name).toBeNull();
    expect(view.percentOff).toBeNull();
    expect(view.amountOffCents).toBeNull();
    expect(view.duration).toBe("once");
    expect(view.durationMonths).toBeNull();
  });

  it("reads the coupon's id alone when the promotion has no coupon at all", () => {
    const view = toCouponView(fakePromoCode({ promotion: { type: "coupon" } }) as never);
    expect(view.couponId).toBe("");
    expect(view.kind).toBe("coupon");
  });

  it("turns an expiry into an ISO string", () => {
    const view = toCouponView(fakePromoCode({ expires_at: 1767225600 }) as never);
    expect(view.expiresAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("reads the kind off the promotion's metadata first", () => {
    const view = toCouponView(fakePromoCode({ metadata: { app: "weft", kind: "referral", referrer_org_id: "org_1" } }) as never);
    expect(view.kind).toBe("referral");
    expect(view.referrerOrgId).toBe("org_1");
  });

  it("falls back to the coupon's metadata for the kind", () => {
    const view = toCouponView(
      fakePromoCode({
        metadata: {},
        promotion: { type: "coupon", coupon: { id: "cou_2", name: null, percent_off: null, amount_off: 500, duration: "repeating", duration_in_months: 3, metadata: { app: "weft", kind: "referral" } } },
      }) as never,
    );
    expect(view.kind).toBe("referral");
    expect(view.amountOffCents).toBe(500);
    expect(view.duration).toBe("repeating");
    expect(view.durationMonths).toBe(3);
  });
});

describe("listCoupons", () => {
  it("asks for 100 codes with their coupons expanded", async () => {
    await listCoupons(client as never);
    expect(client.promotionCodes.list).toHaveBeenCalledWith({ limit: 100, expand: ["data.promotion.coupon"] });
  });

  it("keeps only Weft's codes, stamped on the promotion or on its coupon", async () => {
    const others = fakePromoCode({ id: "promo_x", metadata: { app: "other" }, promotion: { type: "coupon", coupon: { id: "cou_x", metadata: { app: "other" } } } });
    const onCoupon = fakePromoCode({ id: "promo_y", metadata: {}, promotion: { type: "coupon", coupon: { id: "cou_y", metadata: { app: "weft" } } } });
    client.promotionCodes.list.mockResolvedValue({ data: [fakePromoCode(), others, onCoupon] });
    const views = await listCoupons(client as never);
    expect(views.map((v) => v.promotionId)).toEqual(["promo_1", "promo_y"]);
  });
});

describe("findPromotionCode", () => {
  it("looks up one active code by its word", async () => {
    client.promotionCodes.list.mockResolvedValue({ data: [fakePromoCode()] });
    const found = await findPromotionCode(client as never, "SAVE20");
    expect(client.promotionCodes.list).toHaveBeenCalledWith({ code: "SAVE20", active: true, limit: 1 });
    expect(found?.id).toBe("promo_1");
  });

  it("returns null when there is no such code", async () => {
    expect(await findPromotionCode(client as never, "NOPE")).toBeNull();
  });
});

describe("readCoupon", () => {
  it("reads a percent-off code", () => {
    const input = readCoupon({ code: "save20", percentOff: 20 });
    expect(input).toEqual({
      code: "SAVE20",
      name: "SAVE20",
      percentOff: 20,
      amountOffCents: null,
      duration: "once",
      durationMonths: null,
      maxRedemptions: null,
      expiresAt: null,
      firstTimeOnly: false,
    });
  });

  it("reads an amount-off code", () => {
    const input = readCoupon({ code: "TENOFF", amountOffCents: 1000 });
    expect(input.percentOff).toBeNull();
    expect(input.amountOffCents).toBe(1000);
  });

  it("takes the name from the body when there is one", () => {
    expect(readCoupon({ code: "TENOFF", amountOffCents: 1000, name: "Ten off" }).name).toBe("Ten off");
  });

  it("refuses a code that isn't 3 to 40 letters, digits or dashes", () => {
    expect(() => readCoupon({ code: "ab", percentOff: 10 })).toThrow(/3 to 40/);
    expect(() => readCoupon({ code: "a b", percentOff: 10 })).toThrow(/3 to 40/);
    expect(() => readCoupon({ code: 42, percentOff: 10 })).toThrow(/3 to 40/);
  });

  it("refuses both a percent and an amount", () => {
    expect(() => readCoupon({ code: "BOTH", percentOff: 10, amountOffCents: 100 })).toThrow(/not both/);
  });

  it("refuses neither a percent nor an amount", () => {
    expect(() => readCoupon({ code: "NONE" })).toThrow(/not both/);
  });

  it("refuses a percent that isn't a whole number from 1 to 100", () => {
    expect(() => readCoupon({ code: "PCT", percentOff: 0 })).toThrow(/Percent off/);
    expect(() => readCoupon({ code: "PCT", percentOff: 101 })).toThrow(/Percent off/);
    expect(() => readCoupon({ code: "PCT", percentOff: 12.5 })).toThrow(/Percent off/);
    expect(() => readCoupon({ code: "PCT", percentOff: "many" })).toThrow(/Percent off/);
  });

  it("refuses an amount that isn't a whole number from 1 to 1,000,000", () => {
    expect(() => readCoupon({ code: "AMT", amountOffCents: 0 })).toThrow(/Amount off/);
    expect(() => readCoupon({ code: "AMT", amountOffCents: 1_000_001 })).toThrow(/Amount off/);
    expect(() => readCoupon({ code: "AMT", amountOffCents: 1.5 })).toThrow(/Amount off/);
  });

  it("reads an empty number as no number at all", () => {
    expect(readCoupon({ code: "PCT", percentOff: 10, maxRedemptions: "" }).maxRedemptions).toBeNull();
    expect(readCoupon({ code: "PCT", percentOff: 10, maxRedemptions: undefined }).maxRedemptions).toBeNull();
  });

  it("refuses a duration it doesn't know", () => {
    expect(() => readCoupon({ code: "PCT", percentOff: 10, duration: "weekly" })).toThrow(/Duration must be one of/);
  });

  it("reads a repeating coupon's months", () => {
    const input = readCoupon({ code: "PCT", percentOff: 10, duration: "repeating", durationMonths: 3 });
    expect(input.duration).toBe("repeating");
    expect(input.durationMonths).toBe(3);
  });

  it("refuses a repeating coupon with no months", () => {
    expect(() => readCoupon({ code: "PCT", percentOff: 10, duration: "repeating" })).toThrow(/needs a number of months/);
  });

  it("refuses a repeating coupon with too many months", () => {
    expect(() => readCoupon({ code: "PCT", percentOff: 10, duration: "repeating", durationMonths: 37 })).toThrow(/Months/);
  });

  it("ignores the months on a coupon that isn't repeating", () => {
    expect(readCoupon({ code: "PCT", percentOff: 10, duration: "once", durationMonths: 3 }).durationMonths).toBeNull();
  });

  it("reads a max redemption count", () => {
    expect(readCoupon({ code: "PCT", percentOff: 10, maxRedemptions: 50 }).maxRedemptions).toBe(50);
  });

  it("refuses a max redemption count out of range", () => {
    expect(() => readCoupon({ code: "PCT", percentOff: 10, maxRedemptions: 0 })).toThrow(/Max redemptions/);
    expect(() => readCoupon({ code: "PCT", percentOff: 10, maxRedemptions: 100_001 })).toThrow(/Max redemptions/);
  });

  it("reads an expiry as a unix second count", () => {
    const input = readCoupon({ code: "PCT", percentOff: 10, expiresAt: "2027-01-01T00:00:00.000Z" }, Date.parse("2026-10-24T00:00:00.000Z"));
    expect(input.expiresAt).toBe(Math.floor(Date.parse("2027-01-01T00:00:00.000Z") / 1000));
  });

  it("refuses an expiry that isn't in the future", () => {
    expect(() => readCoupon({ code: "PCT", percentOff: 10, expiresAt: "2020-01-01T00:00:00.000Z" })).toThrow(/future/);
  });

  it("refuses an expiry that is exactly now", () => {
    const now = Date.parse("2026-10-24T00:00:00.000Z");
    expect(() => readCoupon({ code: "PCT", percentOff: 10, expiresAt: "2026-10-24T00:00:00.000Z" }, now)).toThrow(/future/);
  });

  it("reads first-time-only when the body says so", () => {
    expect(readCoupon({ code: "PCT", percentOff: 10, firstTimeOnly: true }).firstTimeOnly).toBe(true);
    expect(readCoupon({ code: "PCT", percentOff: 10, firstTimeOnly: "yes" }).firstTimeOnly).toBe(false);
  });
});
