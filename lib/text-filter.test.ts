import { describe, expect, it } from "vitest";
import { filterByQuery, matchesQuery, queryWords } from "./text-filter";

describe("queryWords", () => {
  it("lowercases and splits on whitespace, or a custom break", () => {
    expect(queryWords("  Stripe  HOOK ")).toEqual(["stripe", "hook"]);
    expect(queryWords("stripe_hook", /[\s_]+/)).toEqual(["stripe", "hook"]);
    expect(queryWords("   ")).toEqual([]);
  });
});

describe("matchesQuery", () => {
  it("needs every word, in any case and order, across any field", () => {
    expect(matchesQuery(["STRIPE_WEBHOOK_SECRET"], "hook stripe")).toBe(true);
    expect(matchesQuery(["weft", "~/dev/weft"], "dev weft")).toBe(true);
    expect(matchesQuery(["weft"], "weft blast")).toBe(false);
  });

  it("treats missing fields as empty and a blank query as a match", () => {
    expect(matchesQuery([null, undefined, "x"], "x")).toBe(true);
    expect(matchesQuery([undefined], "")).toBe(true);
  });
});

describe("filterByQuery", () => {
  const rows = [{ n: "alpha" }, { n: "beta" }, { n: "alphabet" }];
  it("keeps the matching rows in order", () => {
    expect(filterByQuery(rows, "alpha", (r) => [r.n])).toEqual([rows[0], rows[2]]);
  });
  it("returns the list itself for a blank query", () => {
    expect(filterByQuery(rows, " ", (r) => [r.n])).toBe(rows);
  });
});
