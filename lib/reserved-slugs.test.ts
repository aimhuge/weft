// lib/reserved-slugs.ts is the one list of names a workspace slug can't take. These tests pin it to its sources
// (@aimhuge/teams and lib/app-routes.ts) and to the database: the newest migration that redefines
// private.org_slug_for must carry exactly the same array, so the sign-up trigger and freeSlug() agree.
import fs from "node:fs";
import path from "node:path";
import { RESERVED_SLUGS } from "@aimhuge/teams";
import { describe, expect, it } from "vitest";
import { allReserved } from "./app-routes";
import { isReservedWorkspaceSlug, RESERVED_WORKSPACE_SLUGS } from "./reserved-slugs";

const MIGRATIONS = path.resolve(__dirname, "..", "supabase", "migrations");

// The reserved array of the latest migration that defines org_slug_for (migration names sort by version).
function sqlReserved(): string[] {
  const latest = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), "utf8"))
    .filter((sql) => sql.includes("function private.org_slug_for"))
    .at(-1);
  const body = /reserved text\[\] := array\[([\s\S]*?)\];/.exec(latest ?? "")?.[1] ?? "";
  return [...body.replace(/--[^\n]*/g, "").matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

describe("RESERVED_WORKSPACE_SLUGS", () => {
  it("holds every slug-shaped root folder from lib/app-routes.ts", () => {
    for (const root of allReserved().filter((s) => /^[a-z0-9-]+$/.test(s))) expect(RESERVED_WORKSPACE_SLUGS).toContain(root);
  });

  it("holds every slug-shaped name from @aimhuge/teams", () => {
    for (const name of [...RESERVED_SLUGS].filter((s) => /^[a-z0-9-]+$/.test(s))) expect(RESERVED_WORKSPACE_SLUGS).toContain(name);
  });

  it("is sorted, unique and slug-shaped (no _next, no favicon.ico)", () => {
    expect([...RESERVED_WORKSPACE_SLUGS]).toEqual([...new Set(RESERVED_WORKSPACE_SLUGS)].sort());
    expect(RESERVED_WORKSPACE_SLUGS).not.toContain("_next");
    expect(RESERVED_WORKSPACE_SLUGS).not.toContain("favicon.ico");
  });

  it("matches private.org_slug_for's array in the latest migration exactly", () => {
    expect(sqlReserved()).toEqual([...RESERVED_WORKSPACE_SLUGS]);
  });
});

describe("isReservedWorkspaceSlug", () => {
  it("refuses Weft's root routes, the package's names and anything under 2 characters", () => {
    for (const s of ["privacy", "terms", "faq", "billing", "checkout", "s", "u", "w", "a", "Privacy", "admin", "vault", "x", ""]) {
      expect(isReservedWorkspaceSlug(s), s).toBe(true);
    }
  });

  it("allows an ordinary slug, and a reserved name with a suffix", () => {
    for (const s of ["acme", "privacy-2", "terms-of-acme", "fotoflo"]) expect(isReservedWorkspaceSlug(s), s).toBe(false);
  });
});
