import { describe, expect, it } from "vitest";
import { catalog, PUKU_METER, PRO_PUKU_TOKENS, TEAM_SEAT_CENTS } from "./plans";

// lib/billing/plans.ts: the catalog shape, the meter name and the paid plans' allowances.

describe("catalog", () => {
  it("orders free, then pro, then team, and pays 10 months for a yearly term", () => {
    expect(catalog.order).toEqual(["free", "pro", "team"]);
    expect(catalog.free).toBe("free");
    expect(catalog.yearlyMonthsCharged).toBe(10);
  });

  it("prices Pro at 2000 cents monthly, with no per-seat surcharge", () => {
    const pro = catalog.get("pro");
    expect(pro.monthlyUnitAmountCents).toBe(2000);
    expect(pro.perSeat).toBe(false);
    expect(catalog.priceCents("pro", "monthly")).toBe(2000);
    expect(catalog.priceCents("pro", "yearly")).toBe(20_000);
  });

  it("keeps Free at zero cents for any interval or seat count", () => {
    expect(catalog.priceCents("free", "monthly")).toBe(0);
    expect(catalog.priceCents("free", "yearly")).toBe(0);
    expect(catalog.totalCents("free", "monthly", 1)).toBe(0);
  });

  it("reads back the pro plan with its blurb and ids", () => {
    const pro = catalog.get("pro");
    expect(pro.id).toBe("pro");
    expect(pro.name).toBe("Pro");
    expect(pro.blurb).toMatch(/Puku/i);
  });

  it("falls back to free on an unknown plan id", () => {
    expect(catalog.get("nope").id).toBe("free");
  });

  it("exposes the Pro Puku allowance and none for Free", () => {
    expect(catalog.allowance("pro", PUKU_METER)).toEqual({ amount: PRO_PUKU_TOKENS });
    expect(catalog.allowance("free", PUKU_METER)).toBeNull();
  });

  it("calls an upgrade a move further down the order", () => {
    expect(catalog.isUpgrade("free", "pro")).toBe(true);
    expect(catalog.isUpgrade("pro", "free")).toBe(false);
  });
});

describe("team", () => {
  it("is priced per seat at 900 cents, so a workspace pays for its people", () => {
    const team = catalog.get("team");
    expect(team.name).toBe("Team");
    expect(team.monthlyUnitAmountCents).toBe(TEAM_SEAT_CENTS);
    expect(team.perSeat).toBe(true);
    expect(catalog.totalCents("team", "monthly", 1)).toBe(900);
    expect(catalog.totalCents("team", "monthly", 5)).toBe(4500);
  });

  it("carries Pro's Puku allowance", () => {
    expect(catalog.allowance("team", PUKU_METER)).toEqual({ amount: PRO_PUKU_TOKENS });
  });

  it("sits above Pro, so moving to it is an upgrade", () => {
    expect(catalog.isUpgrade("pro", "team")).toBe(true);
    expect(catalog.isUpgrade("team", "pro")).toBe(false);
  });
});

describe("PUKU_METER and PRO_PUKU_TOKENS", () => {
  it("names the meter puku_tokens", () => {
    expect(PUKU_METER).toBe("puku_tokens");
  });

  it("puts a positive placeholder on the Pro allowance", () => {
    expect(typeof PRO_PUKU_TOKENS).toBe("number");
    expect(PRO_PUKU_TOKENS).toBeGreaterThan(0);
  });
});