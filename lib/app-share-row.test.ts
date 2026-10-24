// lib/app-share-row.ts: the row-only toolkit around cloud_app_shares. pageForWrite decides whether the page's
// bytes go up again (a folder app is one storage round trip per file, and a save used to make them all again),
// and sameFiles compares the row's file map with the app's.
//
// The blob store is mocked, so the tests can count the uploads a save makes.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ready } from "./app-share-row";

const state = vi.hoisted(() => ({ uploaded: [] as string[], sha: "a".repeat(64) }));

// The sha of a file comes from lib/app-file-sha.ts (cached by mtime and size); it's mocked here so the
// tests can count the uploads a save makes without files on disk.
vi.mock("./app-file-sha", () => ({
  sha256Cached: vi.fn(() => Promise.resolve(state.sha)),
  forgetSha: vi.fn(),
}));

vi.mock("./blob-store", () => ({
  sha256Of: vi.fn(() => Promise.resolve(state.sha)),
  createBlobStore: () => ({
    upload: vi.fn((p: string) => {
      state.uploaded.push(p);
      return Promise.resolve("blob:sha256:x");
    }),
  }),
}));

const { currentPage, pageForWrite, sameFiles, sameManifest } = await import("./app-share-row");

function ready(page: unknown): Ready {
  return { client: {}, orgId: "o1", userId: "u1", app: { id: "a1", name: "App" }, page } as never;
}

beforeEach(() => {
  state.uploaded = [];
});

describe("pageForWrite", () => {
  it("uploads the page's bytes when there's no row yet", async () => {
    const t = ready({ kind: "blob", local: "/tmp/page.html", hash: "h" });
    const now = await pageForWrite(t, null, "o1");
    expect(state.uploaded).toEqual(["/tmp/page.html"]);
    expect(now.kind).toBe("blob");
  });

  it("uploads nothing when the row already points at the same page", async () => {
    const t = ready({ kind: "blob", local: "/tmp/page.html", hash: "h" });
    const existing = { id: "r1", page: `blob:sha256:${state.sha}h`, files: null, org_id: "o1" } as never;
    const now = await pageForWrite(t, existing, "o1");
    expect(state.uploaded).toEqual([]);
    expect(now.page).toBe(`blob:sha256:${state.sha}h`);
  });

  it("uploads again when the page changed", async () => {
    const t = ready({ kind: "blob", local: "/tmp/page.html", hash: "h" });
    const existing = { id: "r1", page: "blob:sha256:oldh", files: null, org_id: "o1" } as never;
    await pageForWrite(t, existing, "o1");
    expect(state.uploaded).toEqual(["/tmp/page.html"]);
  });

  it("uploads again when the row lives under another workspace", async () => {
    const t = ready({ kind: "blob", local: "/tmp/page.html", hash: "h" });
    const existing = { id: "r1", page: `blob:sha256:${state.sha}h`, files: null, org_id: "o2" } as never;
    await pageForWrite(t, existing, "o1");
    expect(state.uploaded).toEqual(["/tmp/page.html"]);
  });

  it("uploads a folder app's files once, and not again when they haven't changed", async () => {
    const t = ready({
      kind: "folder",
      folder: "/tmp/folder",
      entry: "index.html",
      files: [{ relative: "index.html", absolute: "/tmp/folder/index.html" }],
      manifest: {},
    });
    const first = await pageForWrite(t, null, "o1");
    expect(state.uploaded).toEqual(["/tmp/folder/index.html"]);
    expect(first.kind).toBe("folder");

    state.uploaded = [];
    const existing = { id: "r1", page: "index.html", files: { "index.html": state.sha }, org_id: "o1" } as never;
    const second = await pageForWrite(t, existing, "o1");
    expect(state.uploaded).toEqual([]);
    expect(second.files).toEqual({ "index.html": state.sha });
  });

  it("uploads a folder app's files again when one of them changed", async () => {
    const t = ready({
      kind: "folder",
      folder: "/tmp/folder",
      entry: "index.html",
      files: [{ relative: "index.html", absolute: "/tmp/folder/index.html" }],
      manifest: {},
    });
    const existing = { id: "r1", page: "index.html", files: { "index.html": "b".repeat(64) }, org_id: "o1" } as never;
    await pageForWrite(t, existing, "o1");
    expect(state.uploaded).toEqual(["/tmp/folder/index.html"]);
  });
});

describe("sameFiles", () => {
  it("is true for the same map, and for two nulls", () => {
    expect(sameFiles(null, null)).toBe(true);
    expect(sameFiles({ a: "1" }, { a: "1" })).toBe(true);
  });

  it("is false when one is missing, the count differs, or a sha differs", () => {
    expect(sameFiles(null, { a: "1" })).toBe(false);
    expect(sameFiles({ a: "1" }, null)).toBe(false);
    expect(sameFiles({ a: "1" }, { a: "1", b: "2" })).toBe(false);
    expect(sameFiles({ a: "1" }, { a: "2" })).toBe(false);
  });
});

describe("sameManifest", () => {
  it("is true for the same manifest, and for two nulls", () => {
    expect(sameManifest(null, null)).toBe(true);
    expect(sameManifest({}, {})).toBe(true);
  });

  it("is false when one is missing or the manifests differ", () => {
    expect(sameManifest(null, {})).toBe(false);
    expect(sameManifest({}, null)).toBe(false);
    expect(sameManifest({}, { public: ["a.html"] })).toBe(false);
  });
});

describe("currentPage", () => {
  it("names a site's page as it is", async () => {
    const now = await currentPage(ready({ kind: "site", url: "https://example.com/app" }), false, "o1");
    expect(now).toEqual({ kind: "site", page: "https://example.com/app", files: null, manifest: null });
  });
});
