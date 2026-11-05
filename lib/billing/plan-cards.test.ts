import { describe, expect, it } from "vitest";
import { planCards } from "./plan-cards";

describe("planCards", () => {
  it("shows Free, Pro and Team monthly, priced from the catalog", () => {
    const [free, pro, team] = planCards("monthly");
    expect(free).toMatchObject({ id: "free", price: "$0", cadence: "forever", note: null });
    expect(pro).toMatchObject({ id: "pro", name: "Pro", price: "$20", cadence: "/month", note: null });
    expect(team).toMatchObject({ id: "team", price: "$9", cadence: "per seat / month", note: "Billed on your seats" });
    expect(free?.features).toContain("25 MB of shared mini apps");
    expect(pro?.features).toContain("300M Puku tokens a month");
    // Who gets BlastCP Creator, as lib/billing/blastcp-bundle.ts applies it.
    expect(pro?.features).toContain("BlastCP Creator for the owner");
    expect(team?.features).toContain("BlastCP Creator for every seat");
  });

  it("shows Pro's yearly price and saving; Team stays monthly per seat", () => {
    const [, pro, team] = planCards("yearly");
    expect(pro).toMatchObject({ price: "$200", cadence: "/year", note: "Save $40 a year" });
    expect(team).toMatchObject({ price: "$9", cadence: "per seat / month", note: "Billed monthly on your seats" });
  });
});
