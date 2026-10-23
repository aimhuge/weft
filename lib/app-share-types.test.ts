// lib/app-share-types.ts: the share-link contract for a mini app — the URL builder, the
// first-paint dialog state from the remembered memo, the iframe src the viewer frames, and the
// sha a blob share's page route serves. Pure, so a single import covers every branch.
import { describe, expect, it } from "vitest";
import { APP_SLUG_RE, appBlobSha, appFrameSrc, appPublicUrl, appShareUrl, appSlugFrom, paneAddress, seedAppShareState } from "./app-share-types";
import type { CardShareMemo } from "./types-card-detail";
import type { MiniApp } from "./mini-apps";

const SHA = "a".repeat(64);

function makeApp(over: Partial<MiniApp> = {}): Pick<MiniApp, "url" | "share"> {
  return { url: "https://example.com/page", share: undefined, ...over };
}

describe("appShareUrl", () => {
  it("places the id under /a on weft.zip by default", () => {
    expect(appShareUrl("abc123")).toBe("https://weft.zip/a/abc123");
  });

  it("honours a custom origin", () => {
    expect(appShareUrl("abc", "http://localhost:3000")).toBe("http://localhost:3000/a/abc");
  });
});

describe("appPublicUrl", () => {
  it("puts a personal app under @username", () => {
    expect(appPublicUrl("user", "fotoflo", "growth")).toBe("https://weft.zip/@fotoflo/apps/growth");
  });

  it("puts a team app under the workspace's slug", () => {
    expect(appPublicUrl("org", "aimhuge", "growth", "http://localhost:3000")).toBe("http://localhost:3000/aimhuge/apps/growth");
  });
});

describe("appSlugFrom", () => {
  it("drops the emoji and lowercases", () => {
    expect(appSlugFrom("📈 Growth")).toBe("growth");
  });

  it("joins words with hyphens and folds accents", () => {
    expect(appSlugFrom("Café  Sales — Q4!")).toBe("cafe-sales-q4");
  });

  it("caps the length without a trailing hyphen", () => {
    const slug = appSlugFrom(`${"a".repeat(39)} b`);
    expect(slug).toBe("a".repeat(39));
    expect(APP_SLUG_RE.test(slug)).toBe(true);
  });

  it("falls back to app when nothing usable is left", () => {
    expect(appSlugFrom("🐙")).toBe("app");
  });
});

describe("paneAddress", () => {
  it("prefers the link's public address once the memo has one", () => {
    const app: MiniApp = {
      id: "g",
      name: "📈 Growth",
      url: "file:///Users/me/.weft/apps/growth/index.html",
      addedAt: 1,
      share: { id: "k3x9", mode: "public", hasPassword: false, url: "https://weft.zip/@fotoflo/apps/growth" },
    };
    expect(paneAddress(app, app.url)).toBe("📈 Growth · weft.zip/@fotoflo/apps/growth");
  });
});

describe("paneAddress", () => {
  const growth: MiniApp = { id: "g", name: "📈 Growth", url: "file:///Users/me/.weft/apps/growth/index.html", addedAt: 1 };

  it("shows a saved local app's name instead of its file path", () => {
    expect(paneAddress(growth, growth.url)).toBe("📈 Growth");
  });

  it("adds the weft.zip link once the app has one", () => {
    const shared = { ...growth, share: { id: "k3x9", mode: "private" as const, hasPassword: false } };
    expect(paneAddress(shared, growth.url)).toBe("📈 Growth · weft.zip/a/k3x9");
  });

  it("ignores a share memo with no link yet", () => {
    const unshared = { ...growth, share: { id: null, mode: "private" as const, hasPassword: false } };
    expect(paneAddress(unshared, growth.url)).toBe("📈 Growth");
  });

  it("still names the app on its own page with a #hash", () => {
    expect(paneAddress(growth, `${growth.url}#retention`)).toBe("📈 Growth");
  });

  it("shows the address of a page further into the app", () => {
    const deeper = "file:///Users/me/.weft/apps/growth/other.html";
    expect(paneAddress(growth, deeper)).toBe(deeper);
  });

  it("keeps a web app's address", () => {
    const repo: MiniApp = { id: "r", name: "🐙 Weft repo", url: "https://github.com/aimhuge/weft", addedAt: 1 };
    expect(paneAddress(repo, repo.url)).toBe(repo.url);
  });

  it("shows any other page's address", () => {
    expect(paneAddress(undefined, "file:///Users/me/.weft/show/plan.html")).toBe("file:///Users/me/.weft/show/plan.html");
  });
});

describe("seedAppShareState", () => {
  it("returns signed-out for a signed-out visitor, even with a memo", () => {
    const memo: CardShareMemo = { id: "m1", mode: "public", hasPassword: false };
    expect(seedAppShareState(makeApp({ url: "file:///x.html", share: memo }), true)).toEqual({ kind: "signed-out" });
  });

  it("returns a private, no-link state for a file: app with no memo", () => {
    const state = seedAppShareState(makeApp({ url: "file:///Users/me/show/page.html" }), false);
    expect(state).toEqual({ kind: "ok", id: null, url: null, mode: "private", hasPassword: false, shows: "blob", manifest: null, owner: null, slug: null, orgId: null, publicUrl: null, owners: { user: null, orgs: [] }, preview: null, previewing: false });
  });

  it("returns a private, no-link state for an https app with no memo", () => {
    const state = seedAppShareState(makeApp({ url: "https://example.com/dash" }), false);
    expect(state).toEqual({ kind: "ok", id: null, url: null, mode: "private", hasPassword: false, shows: "site", manifest: null, owner: null, slug: null, orgId: null, publicUrl: null, owners: { user: null, orgs: [] }, preview: null, previewing: false });
  });

  it("hydrates a memo's id and url, keeping its mode and password flag", () => {
    const memo: CardShareMemo = { id: "m1", mode: "email", hasPassword: false };
    const state = seedAppShareState(makeApp({ url: "https://example.com/dash", share: memo }), false);
    expect(state).toEqual({ kind: "ok", id: "m1", url: "https://weft.zip/a/m1", mode: "email", hasPassword: false, shows: "site", manifest: null, owner: null, slug: null, orgId: null, publicUrl: null, owners: { user: null, orgs: [] }, preview: null, previewing: false });
  });

  it("hydrates a memo with no id (url stays null)", () => {
    const memo: CardShareMemo = { id: null, mode: "password", hasPassword: true };
    const state = seedAppShareState(makeApp({ url: "file:///x.html", share: memo }), false);
    expect(state).toEqual({ kind: "ok", id: null, url: null, mode: "password", hasPassword: true, shows: "blob", manifest: null, owner: null, slug: null, orgId: null, publicUrl: null, owners: { user: null, orgs: [] }, preview: null, previewing: false });
  });
});

describe("appFrameSrc", () => {
  it("frames a site share at its address", () => {
    expect(appFrameSrc("s1", { kind: "site", page: "https://example.com/dash" })).toBe("https://example.com/dash");
  });

  it("serves a blob share through the page route", () => {
    expect(appFrameSrc("s1", { kind: "blob", page: `blob:sha256:${SHA}` })).toBe(`/api/a/s1/page`);
  });

  it("keeps the #hash on a blob share so the page lands on the right anchor", () => {
    expect(appFrameSrc("s1", { kind: "blob", page: `blob:sha256:${SHA}#step-2` })).toBe(`/api/a/s1/page#step-2`);
  });
});

describe("appBlobSha", () => {
  it("returns the sha for a well-formed blob ref", () => {
    expect(appBlobSha({ kind: "blob", page: `blob:sha256:${SHA}` })).toBe(SHA);
  });

  it("strips a trailing #hash before validating the sha", () => {
    expect(appBlobSha({ kind: "blob", page: `blob:sha256:${SHA}#step-2` })).toBe(SHA);
  });

  it("returns null for a site share", () => {
    expect(appBlobSha({ kind: "site", page: "https://example.com/dash" })).toBeNull();
  });

  it("returns null for a blob ref that isn't 64 hex chars", () => {
    expect(appBlobSha({ kind: "blob", page: "blob:sha256:short" })).toBeNull();
    expect(appBlobSha({ kind: "blob", page: `blob:sha256:${"z".repeat(64)}` })).toBeNull();
  });

  it("returns null when the page doesn't even start with the blob prefix", () => {
    expect(appBlobSha({ kind: "blob", page: "https://example.com/dash" })).toBeNull();
  });
});
