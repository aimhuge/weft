// lib/app-routes.ts: appLinkTarget(pathname) decides whether a request is one of weft.zip's public
// app links and, if so, what the rewrite target is. The reserved set is hard-coded for the edge
// runtime (Vercel has no app/ folder); this test walks the source tree once at test time and
// asserts every first-level folder under app/ is in the set, so a new top-level route prefix
// without updating the set fails the test. Path-to-regexp's matcher forms are tested separately:
// the proxy needs them to filter the matcher set, not the rule itself.
import fs from "node:fs";
import path from "node:path";
import { match as ptrMatch } from "next/dist/compiled/path-to-regexp";
import { describe, expect, it } from "vitest";
import { allReserved, appLinkMatchers, appLinkTarget, USERNAME_SLUG_RE } from "./app-routes";

// Every first-level static folder under app/ at test time: the folders that, without being in the
// reserved set, would be eaten by the /<org>/apps/<slug> rewrite. The test fails loudly when a
// new folder is added that the source's hard-coded set doesn't list. Walked once per file, not
// per test.
function sourceReservedFolders(): string[] {
  const appDir = path.resolve(__dirname, "..", "app");
  if (!fs.existsSync(appDir)) return [];
  return fs
    .readdirSync(appDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !name.startsWith(".") && !name.startsWith("@") && !name.startsWith("[") && !name.startsWith("("));
}

// Wrap path-to-regexp's loose return into a typed result: a non-match is null, a match is its
// params object. The matcher's TypeScript signature is wider than the test needs.
function matchOne(pattern: string): (path: string) => Record<string, string> | null {
  const fn = ptrMatch(pattern) as unknown as (path: string) => false | { params: Record<string, string> };
  return (path) => {
    const out = fn(path);
    return out === false ? null : out.params;
  };
}

describe("the hard-coded reserved set", () => {
  it("covers every first-level static folder under app/ (the rule that's easy to forget when adding a route)", () => {
    const sourceFolders = sourceReservedFolders();
    const reserved = new Set(allReserved());
    for (const name of sourceFolders) {
      expect(reserved.has(name), `app/${name} is a first-level folder but not in the reserved set; add it to RESERVED in lib/app-routes.ts`).toBe(true);
    }
  });

  it("includes _next (Next's internal segment, which never goes through a route folder)", () => {
    expect(new Set(allReserved()).has("_next")).toBe(true);
  });

  it("is sorted longest-first so a name that contains another isn't eaten", () => {
    const list = allReserved();
    for (let i = 1; i < list.length; i++) expect(list[i - 1]!.length).toBeGreaterThanOrEqual(list[i]!.length);
  });

  it("refuses /api/apps/secrets, /api/apps/share, and /api/apps/build (the routes that would otherwise be rewritten)", () => {
    for (const slug of ["secrets", "share", "build"]) {
      expect(appLinkTarget(`/api/apps/${slug}`)).toBeNull();
    }
  });
});

describe("USERNAME_SLUG_RE", () => {
  it("accepts lowercase, digits and inner hyphens; rejects uppercase, leading/trailing hyphens, empties", () => {
    expect(USERNAME_SLUG_RE.test("fotoflo")).toBe(true);
    expect(USERNAME_SLUG_RE.test("a1")).toBe(true);
    expect(USERNAME_SLUG_RE.test("a-b-c")).toBe(true);
    expect(USERNAME_SLUG_RE.test("FOTOFLO")).toBe(false);
    expect(USERNAME_SLUG_RE.test("Aimhuge")).toBe(false);
    expect(USERNAME_SLUG_RE.test("-foo")).toBe(false);
    expect(USERNAME_SLUG_RE.test("foo-")).toBe(false);
    expect(USERNAME_SLUG_RE.test("")).toBe(false);
    expect(USERNAME_SLUG_RE.test("a".repeat(41))).toBe(false);
  });
});

describe("appLinkTarget (user rule)", () => {
  it("rewrites /@<user>/apps/<slug> to /u/<user>/apps/<slug>", () => {
    expect(appLinkTarget("/@fotoflo/apps/growth")).toBe("/u/fotoflo/apps/growth");
    expect(appLinkTarget("/@a-b/apps/g")).toBe("/u/a-b/apps/g");
  });

  it("rejects a /u/<user>/apps/<slug> (filesystem route, not a link)", () => {
    expect(appLinkTarget("/u/fotoflo/apps/growth")).toBeNull();
  });

  it("rejects an uppercase username or slug (the slug rules are lowercase)", () => {
    expect(appLinkTarget("/@FOTOFLO/apps/growth")).toBeNull();
    expect(appLinkTarget("/@fotoflo/apps/GROWTH")).toBeNull();
  });

  it("rejects a /@<user>/apps/<slug>/<more> (an app link has exactly one apps/<slug> tail)", () => {
    expect(appLinkTarget("/@fotoflo/apps/growth/extra")).toBeNull();
  });

  it("rejects /api/apps/share on the user rule (its /@ prefix is missing)", () => {
    expect(appLinkTarget("/api/apps/share")).toBeNull();
  });
});

describe("appLinkTarget (org rule)", () => {
  it("rewrites /<org>/apps/<slug> to /w/<org>/apps/<slug>", () => {
    expect(appLinkTarget("/aimhuge/apps/growth")).toBe("/w/aimhuge/apps/growth");
    expect(appLinkTarget("/a-b/apps/g")).toBe("/w/a-b/apps/g");
  });

  it("refuses every source-reserved first-level folder under app/ as the org segment (the point of the reserve)", () => {
    // Walk the real source tree: appLinkTarget must refuse every first-level folder under app/ as
    // an org name. A new top-level folder breaks this test until RESERVED is updated.
    for (const name of sourceReservedFolders()) {
      expect(appLinkTarget(`/${name}/apps/whatever`)).toBeNull();
    }
  });

  it("refuses /api/apps and /api/apps/share (the example that would otherwise route)", () => {
    expect(appLinkTarget("/api/apps/share")).toBeNull();
    expect(appLinkTarget("/api/apps")).toBeNull();
  });

  it("refuses /_next/... and /u/... and /a/... and /s/... and /w/... as the first segment", () => {
    expect(appLinkTarget("/_next/x/apps/y")).toBeNull();
    expect(appLinkTarget("/u/x/apps/y")).toBeNull();
    expect(appLinkTarget("/a/x/apps/y")).toBeNull();
    expect(appLinkTarget("/s/x/apps/y")).toBeNull();
    expect(appLinkTarget("/w/x/apps/y")).toBeNull();
  });

  it("refuses /<org>/apps/<slug>/<more> (an app link has exactly one apps/<slug> tail)", () => {
    expect(appLinkTarget("/aimhuge/apps/growth/extra")).toBeNull();
  });

  it("refuses when the path is missing /apps/<slug> or trailing", () => {
    expect(appLinkTarget("/aimhuge")).toBeNull();
    expect(appLinkTarget("/aimhuge/apps/")).toBeNull();
    expect(appLinkTarget("/apps/growth")).toBeNull();
  });

  it("is case-sensitive: an uppercase org is not the same as a lowercase one and is rejected", () => {
    expect(appLinkTarget("/AIMHUGE/apps/x")).toBeNull();
  });

  it("returns null for paths that aren't an app link shape at all", () => {
    expect(appLinkTarget("/login")).toBeNull();
    expect(appLinkTarget("/")).toBeNull();
    expect(appLinkTarget("")).toBeNull();
  });

  it("strips a single trailing slash", () => {
    expect(appLinkTarget("/aimhuge/apps/growth/")).toBe("/w/aimhuge/apps/growth");
    expect(appLinkTarget("/@fotoflo/apps/growth/")).toBe("/u/fotoflo/apps/growth");
  });
});

describe("appLinkTarget for shared threads", () => {
  it("rewrites /@<user>/threads/<slug> to /u/<user>/threads/<slug>", () => {
    expect(appLinkTarget("/@fotoflo/threads/login-fix")).toBe("/u/fotoflo/threads/login-fix");
    expect(appLinkTarget("/@fotoflo/threads/login-fix/")).toBe("/u/fotoflo/threads/login-fix");
  });

  it("has no org form and refuses bad shapes", () => {
    expect(appLinkTarget("/aimhuge/threads/login-fix")).toBeNull();
    expect(appLinkTarget("/@fotoflo/threads/Login_Fix")).toBeNull();
    expect(appLinkTarget("/@fotoflo/threads")).toBeNull();
  });
});

describe("appLinkTarget is a pure function", () => {
  it("returns null for non-string input without throwing", () => {
    // The proxy never calls it with non-strings, but the contract is "pure, fail-safe at the boundary".
    expect(appLinkTarget(undefined as unknown as string)).toBeNull();
    expect(appLinkTarget(null as unknown as string)).toBeNull();
  });

  it("returns null for a path that doesn't start with /", () => {
    expect(appLinkTarget("aimhuge/apps/growth")).toBeNull();
  });
});

describe("appLinkMatchers", () => {
  const matchers = appLinkMatchers();

  it("returns the user and org matchers", () => {
    expect(matchers).toEqual(["/@:username/apps/:slug", "/:org/apps/:slug", "/@:username/threads/:slug"]);
  });

  it("the user matcher accepts /@<user>/apps/<slug> and rejects /u/...", () => {
    const m = matchOne(matchers[0]!);
    expect(m("/@fotoflo/apps/growth")).toEqual({ username: "fotoflo", slug: "growth" });
    expect(m("/u/fotoflo/apps/growth")).toBeNull();
  });

  it("the org matcher accepts /<org>/apps/<slug> and rejects paths with extra segments", () => {
    // path-to-regexp's :name is a single segment by default, so /u/x/apps/y fails (three segments
    // before the trailing /apps/...). /api/apps/share and /aimhuge/apps/growth match. The proxy
    // also calls appLinkTarget to filter out reserved first segments like api and u, which the
    // matcher alone can't enforce.
    const m = matchOne(matchers[1]!);
    expect(m("/aimhuge/apps/growth")).toEqual({ org: "aimhuge", slug: "growth" });
    expect(m("/api/apps/share")).toEqual({ org: "api", slug: "share" });
    expect(m("/u/x/apps/y")).toBeNull();
  });
});
