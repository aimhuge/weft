import { describe, expect, it } from "vitest";
import {
  LOWER_MIDDLE_INCOME,
  LOW_INCOME,
  REGIONAL_VARIANTS,
  regionalCents,
  regionalTier,
  tierFor,
} from "./regional";

// lib/billing/regional.ts: World Bank income tiers and the regional Pro prices.

describe("tierFor", () => {
  it("maps a low-income country to the low tier", () => {
    expect(tierFor("ET")).toBe("low");
    expect(tierFor("UG")).toBe("low");
  });

  it("maps a lower-middle-income country to the lowerMiddle tier", () => {
    expect(tierFor("IN")).toBe("lowerMiddle");
    expect(tierFor("KE")).toBe("lowerMiddle");
  });

  it("returns null for a country in neither group", () => {
    expect(tierFor("US")).toBeNull();
    expect(tierFor("DE")).toBeNull();
  });

  it("returns null for a missing country", () => {
    expect(tierFor(null)).toBeNull();
    expect(tierFor(undefined)).toBeNull();
    expect(tierFor("")).toBeNull();
    expect(tierFor("   ")).toBeNull();
  });

  it("ignores case and surrounding whitespace", () => {
    expect(tierFor("et")).toBe("low");
    expect(tierFor("  et  ")).toBe("low");
    expect(tierFor("in")).toBe("lowerMiddle");
    expect(tierFor("\tin\n")).toBe("lowerMiddle");
  });
});

describe("regionalTier", () => {
  it("picks the cheapest tier when one country qualifies for low", () => {
    expect(regionalTier("US", "ET")).toBe("low");
    expect(regionalTier("IN", "ET")).toBe("low");
  });

  it("picks lowerMiddle when that is the only qualifying tier", () => {
    expect(regionalTier("US", "IN")).toBe("lowerMiddle");
  });

  it("returns null when no country qualifies", () => {
    expect(regionalTier()).toBeNull();
    expect(regionalTier("US", "DE", null, undefined)).toBeNull();
  });
});

describe("regionalCents", () => {
  it("prices the low tier at 500 cents and lowerMiddle at 1000", () => {
    expect(regionalCents("low")).toBe(500);
    expect(regionalCents("lowerMiddle")).toBe(1000);
  });
});

describe("income groups", () => {
  it("keeps the groups disjoint", () => {
    for (const code of LOW_INCOME) expect(LOWER_MIDDLE_INCOME.has(code)).toBe(false);
    for (const code of LOWER_MIDDLE_INCOME) expect(LOW_INCOME.has(code)).toBe(false);
  });

  it("names the Stripe price variant each tier sells through", () => {
    expect(REGIONAL_VARIANTS).toEqual({ low: "regional_low", lowerMiddle: "regional_lower_middle" });
  });
});
