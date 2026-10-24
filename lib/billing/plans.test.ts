import { describe, expect, it } from "vitest";
import { BLASTCP_CREATOR, BLASTCP_FREE, catalog, FREE_TIER, freeTierCapLabel, PUKU_METER, REGIONAL_PRO_CENTS, PRO_PUKU_TOKENS, STARTUP_TEAM, TEAM_SEAT_CENTS } from "./plans";

// lib/billing/plans.ts: the catalog shape, the meter name and the paid plans' allowances.

describe("catalog", () => {
  it("orders the $0 plans, then pro, then team, and pays 10 months for a yearly term", () => {
    expect(catalog.order).toEqual(["free", "oss", "edu", "pro", "team"]);
    expect(catalog.paid).toEqual(["pro", "team"]);
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

describe("blastcp", () => {
  it("includes BlastCP Free on Free and Creator on Pro and Team", () => {
    expect(catalog.get("free").blastcp).toBe(BLASTCP_FREE);
    expect(catalog.get("pro").blastcp).toBe(BLASTCP_CREATOR);
    // Not BlastCP Pro: that's $29 flat, more than a one-seat Team pays.
    expect(catalog.get("team").blastcp).toBe(BLASTCP_CREATOR);
  });

  it("includes Creator on Open Source and Education too", () => {
    expect(catalog.get("oss").blastcp).toBe(BLASTCP_CREATOR);
    expect(catalog.get("edu").blastcp).toBe(BLASTCP_CREATOR);
  });

  it("mirrors BlastCP's catalog: Free's credit is spent once, Creator's is monthly and unlimited", () => {
    expect(BLASTCP_FREE).toMatchObject({ brands: 1, channels: 3, postsPerMonth: 30, creditDollars: 0.5, creditResets: false });
    expect(BLASTCP_CREATOR).toMatchObject({ brands: 1, channels: null, postsPerMonth: null, creditDollars: 3, creditResets: true });
  });
});

describe("open source and education", () => {
  it("are $0 plans with no Puku allowance, so they stay on the free tier's cap", () => {
    for (const id of ["oss", "edu"] as const) {
      expect(catalog.get(id).id).toBe(id);
      expect(catalog.priceCents(id, "monthly")).toBe(0);
      expect(catalog.allowance(id, PUKU_METER)).toBeNull();
    }
    expect(catalog.get("oss").name).toBe("Open Source");
    expect(catalog.get("edu").name).toBe("Education");
  });

  it("calls a move from either to Pro an upgrade", () => {
    expect(catalog.isUpgrade("oss", "pro")).toBe(true);
    expect(catalog.isUpgrade("edu", "pro")).toBe(true);
  });
});

describe("free tier", () => {
  it("caps Free at 150 requests and 1M tokens a day, with no allowance of its own", () => {
    expect(FREE_TIER).toMatchObject({ name: "Free tier", plans: ["free", "oss", "edu"], dailyRequests: 150, dailyTokens: 1_000_000 });
    for (const id of FREE_TIER.plans) expect(catalog.get(id).allowances).toBeUndefined();
  });

  it("labels the cap in millions, or thousands under a million", () => {
    expect(freeTierCapLabel()).toBe("1M tokens a day");
    expect(freeTierCapLabel({ ...FREE_TIER, dailyTokens: 500_000 })).toBe("500K tokens a day");
  });
});

describe("regional pro", () => {
  it("prices Pro at $5 in low-income and $10 in lower-middle-income countries, under Pro", () => {
    expect(REGIONAL_PRO_CENTS).toEqual({ low: 500, lowerMiddle: 1000 });
    expect(REGIONAL_PRO_CENTS.lowerMiddle).toBeLessThan(catalog.priceCents("pro", "monthly"));
  });
});

describe("startup team", () => {
  it("is Team free for six months, then half price for six, on up to 10 seats", () => {
    expect(STARTUP_TEAM).toEqual({ freeMonths: 6, halfPriceMonths: 6, maxSeats: 10, maxRaisedUsd: 5_000_000, maxAgeYears: 3 });
    expect(catalog.get("team").perSeat).toBe(true);
  });
});
