import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { readNeeds } from "./app-read-needs";

const { deriveNeeds } = createRequire(import.meta.url)("../electron/app-data-grants.cjs") as {
  deriveNeeds: (reads: Record<string, unknown>) => string[];
};

const GROWTH = {
  reads: {
    signups: { supabase: "growth_signups_by_day", args: { days: 30 } },
    traffic: { ga4: { metrics: [{ name: "sessions" }] } },
  },
};

describe("readNeeds", () => {
  it("names the author secrets a manifest's reads need", () => {
    expect(readNeeds(GROWTH)).toEqual(["GA4_PROPERTY_ID", "GA4_SERVICE_ACCOUNT_JSON", "SUPABASE_SECRET_KEY"]);
    expect(readNeeds({ reads: { a: { supabase: "f" } } })).toEqual(["SUPABASE_SECRET_KEY"]);
  });

  it("is empty for a manifest without reads, or a malformed one", () => {
    expect(readNeeds(null)).toEqual([]);
    expect(readNeeds({})).toEqual([]);
    expect(readNeeds({ reads: [] })).toEqual([]);
    expect(readNeeds({ reads: { a: null, b: "x", c: {} } })).toEqual([]);
  });

  it("agrees with the Mac's deriveNeeds (electron/app-data-grants.cjs)", () => {
    expect(readNeeds(GROWTH)).toEqual(deriveNeeds(GROWTH.reads));
  });
});
