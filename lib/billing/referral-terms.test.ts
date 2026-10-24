import { describe, expect, it } from "vitest";

// lib/billing/referral-terms.ts: the referral offer's numbers, the coupon id that names them, the label the billing
// page shows, and the workspace code it types at Checkout. Client-safe, so no mocks are needed.

import { REFERRAL_TERMS, referralCodeFrom, referralCouponId, referralOfferLabel } from "./referral-terms";

describe("REFERRAL_TERMS", () => {
  it("is 20% off for 3 months, with a $20 reward", () => {
    expect(REFERRAL_TERMS).toEqual({ percentOff: 20, months: 3, rewardCents: 2000 });
  });
});

describe("referralCouponId", () => {
  it("names the shared coupon after the default terms", () => {
    expect(referralCouponId()).toBe("weft-referral-20off-3mo");
  });

  it("names it after other terms too (a new offer is a new coupon)", () => {
    expect(referralCouponId({ percentOff: 50, months: 6 })).toBe("weft-referral-50off-6mo");
  });
});

describe("referralOfferLabel", () => {
  it("reads as a sentence about the offer", () => {
    expect(referralOfferLabel()).toBe("20% off their first 3 months; you get $20 off your bill");
  });

  it("follows the terms it is given", () => {
    // The default terms are a const, so their types are the literal numbers. Other terms are
    // ordinary numbers, widened here and cast back to what the function takes.
    const terms: { percentOff: number; months: number; rewardCents: number } = { percentOff: 15, months: 2, rewardCents: 500 };
    expect(referralOfferLabel(terms as Parameters<typeof referralOfferLabel>[0])).toBe("15% off their first 2 months; you get $5 off your bill");
  });
});

describe("referralCodeFrom", () => {
  it("upper-cases the slug and prefixes WEFT-", () => {
    expect(referralCodeFrom("acme")).toBe("WEFT-ACME");
  });

  it("turns anything but letters, digits and dashes into a dash", () => {
    expect(referralCodeFrom("acme co")).toBe("WEFT-ACME-CO");
    expect(referralCodeFrom("a_b+c")).toBe("WEFT-A-B-C");
  });

  it("drops leading and trailing dashes", () => {
    expect(referralCodeFrom("--acme--")).toBe("WEFT-ACME");
    expect(referralCodeFrom("!!")).toBe("WEFT-TEAM");
  });

  it("falls back to TEAM when nothing usable is left", () => {
    expect(referralCodeFrom("")).toBe("WEFT-TEAM");
    expect(referralCodeFrom("***")).toBe("WEFT-TEAM");
  });

  it("keeps the code inside Stripe's 30-character alphabet", () => {
    expect(referralCodeFrom("a-very-long-workspace-slug-indeed")).toBe("WEFT-A-VERY-LONG-WORKSPAC");
    expect(referralCodeFrom("x".repeat(50))).toHaveLength(25);
  });

  it("adds a suffix when one is given", () => {
    expect(referralCodeFrom("acme", "417")).toBe("WEFT-ACME-417");
  });
});
