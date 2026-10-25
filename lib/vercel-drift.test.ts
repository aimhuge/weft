import { describe, expect, it } from "vitest";
import { driftBadge, driftCount, driftGaps, driftLine, driftOf, driftParts, missingPairs, shownDrift, vaultKey, type VercelDrift } from "./vercel-drift";
import type { VercelEnvRow } from "./vercel-view";

// The vault ⇄ Vercel drift: names on Vercel the vault has no value for, vault values Vercel lacks, by environment.

const rows: VercelEnvRow[] = [
  { name: "KEY", environment: "development", inVault: true, onVercel: true },
  { name: "A", environment: "preview", inVault: true, onVercel: false },
  { name: "B", environment: "preview", inVault: true, onVercel: false },
  { name: "PLAIN", environment: "preview", inVault: false, onVercel: true, pullable: true },
  { name: "PLAIN", environment: "production", inVault: false, onVercel: true, pullable: true },
  { name: "SECRET", environment: "production", inVault: false, onVercel: true },
  { name: "BLANK", environment: "production", inVault: false, onVercel: false },
  { name: "A", environment: "production", inVault: true, onVercel: false },
];

const drift = (folder: string, r = rows): VercelDrift => ({ folder, label: "o/web", project: "web", rows: r });

describe("vercel-drift", () => {
  it("sums up what drifted, names once each", () => {
    expect(driftOf(rows)).toEqual({ notInVault: ["PLAIN", "SECRET"], pullable: ["PLAIN"], missing: { preview: ["A", "B"], production: ["A"] } });
    expect(driftCount(driftOf(rows))).toBe(5);
  });

  it("says it as questions, or without them for hover text", () => {
    expect(driftParts(driftOf(rows))).toEqual(["2 on Vercel not in vault: pull?", "2 missing on preview: push?", "1 missing on production: push?"]);
    expect(driftParts(driftOf(rows), false)).toEqual(["2 on Vercel not in vault", "2 missing on preview", "1 missing on production"]);
  });

  it("doesn't offer a pull when nothing on Vercel can come down", () => {
    const sensitive = rows.filter((r) => r.name === "SECRET");
    expect(driftParts(driftOf(sensitive))).toEqual(["1 on Vercel not in vault"]);
  });

  it("gives a line only when there's drift", () => {
    expect(driftLine(rows)).toBe("2 on Vercel not in vault: pull? · 2 missing on preview: push? · 1 missing on production: push?");
    expect(driftLine([rows[0]!])).toBeNull();
  });

  it("filters to the board's project", () => {
    const all = [drift("/a"), drift("/b")];
    expect(shownDrift(all, "/b")).toEqual([all[1]]);
    expect(shownDrift(all, null)).toEqual(all);
  });

  it("counts and titles the rail badge over drifted projects only", () => {
    expect(driftBadge([drift("/a"), drift("/b", [rows[0]!])])).toEqual({ count: 5, title: "▲ web: 2 on Vercel not in vault, 2 missing on preview, 1 missing on production" });
    expect(driftBadge([])).toEqual({ count: 0, title: "" });
  });

  it("turns drift into the copilot's gaps, a few names each", () => {
    const many = ["A", "B", "C", "D", "E"].map((name): VercelEnvRow => ({ name, environment: "preview", inVault: true, onVercel: false }));
    expect(driftGaps([drift("/a", many), drift("/b", [rows[0]!]), drift("/c", rows.slice(3, 4))])).toEqual([
      expect.objectContaining({ folder: "/a", what: "vault ⇄ Vercel env sync (5 vault secrets missing on Vercel preview (A, B, C, D, …))", why: "web on Vercel and the o/web vault holding the same names" }),
      expect.objectContaining({ folder: "/c", what: "vault ⇄ Vercel env sync (1 Vercel env vars not in the 🔐 vault (PLAIN))" }),
    ]);
  });

  it("lists what Push sends", () => {
    expect(missingPairs(rows)).toEqual([
      { name: "A", environment: "preview" },
      { name: "B", environment: "preview" },
      { name: "A", environment: "production" },
    ]);
  });

  it("keys the vault by its names and which hold a value", () => {
    expect(vaultKey([{ secrets: [{ name: "A", environment: "preview" }, { name: "B", environment: "production", missing: true }] }])).toBe("preview:A:1\nproduction:B:0");
  });
});
