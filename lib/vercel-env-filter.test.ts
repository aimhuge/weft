import { describe, expect, it } from "vitest";
import { envState, filterEnvRows, stateCounts } from "./vercel-env-filter";
import type { VercelEnvRow } from "./vercel-view";

const rows: VercelEnvRow[] = [
  { name: "NEXT_PUBLIC_POSTHOG_KEY", environment: "development", inVault: true, onVercel: false },
  { name: "GITHUB_CLIENT_ID", environment: "development", inVault: true, onVercel: true },
  { name: "VERCEL_ONLY", environment: "preview", inVault: false, onVercel: true },
  { name: "CRON_SECRET", environment: "development", inVault: false, onVercel: false },
];

describe("vercel env filter", () => {
  it("names each row's state", () => {
    expect(rows.map(envState)).toEqual(["push", "onVercel", "vercelOnly", "noValue"]);
  });

  it("filters by every word of the query, any case", () => {
    expect(filterEnvRows(rows, "", "all")).toEqual(rows);
    expect(filterEnvRows(rows, "posthog", "all")).toEqual([rows[0]]);
    expect(filterEnvRows(rows, " key  next ", "all")).toEqual([rows[0]]);
    expect(filterEnvRows(rows, "nothing", "all")).toEqual([]);
  });

  it("filters by state, with the query", () => {
    expect(filterEnvRows(rows, "", "push")).toEqual([rows[0]]);
    expect(filterEnvRows(rows, "", "noValue")).toEqual([rows[3]]);
    expect(filterEnvRows(rows, "github", "push")).toEqual([]);
  });

  it("counts rows per state", () => {
    expect(stateCounts(rows)).toEqual({ all: 4, push: 1, onVercel: 1, vercelOnly: 1, noValue: 1 });
  });
});
