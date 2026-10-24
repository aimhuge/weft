import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { folderVersion, VERSION_RE, versionedFrameSrc } from "./app-share-frame";

const A = "a".repeat(64);
const B = "b".repeat(64);

describe("folderVersion", () => {
  it("is 32 hex characters, the same for the same files in any order", () => {
    const v = folderVersion({ "index.html": A, "app.js": B });
    expect(v).toMatch(VERSION_RE);
    expect(folderVersion({ "app.js": B, "index.html": A })).toBe(v);
  });

  it("changes when a file is added, removed or changed", () => {
    const v = folderVersion({ "index.html": A });
    expect(folderVersion({ "index.html": B })).not.toBe(v);
    expect(folderVersion({ "index.html": A, "x.css": A })).not.toBe(v);
    expect(folderVersion({})).not.toBe(v);
  });
});

describe("versionedFrameSrc", () => {
  it("puts a page's sha in its path, keeping the #hash", () => {
    expect(versionedFrameSrc("s1", { kind: "blob", page: `blob:sha256:${A}`, files: null })).toBe(`/api/a/s1/page/${A}`);
    expect(versionedFrameSrc("s1", { kind: "blob", page: `blob:sha256:${A}#step-2`, files: null })).toBe(`/api/a/s1/page/${A}#step-2`);
  });

  it("puts a folder's version before its entry, so siblings resolve under it", () => {
    const files = { "index.html": A, "app.js": B };
    expect(versionedFrameSrc("s1", { kind: "folder", page: "index.html", files })).toBe(`/api/a/s1/v/${folderVersion(files)}/index.html`);
    expect(versionedFrameSrc("s1", { kind: "folder", page: "", files })).toBe(`/api/a/s1/v/${folderVersion(files)}/index.html`);
  });

  it("falls back to the unversioned frame for a site, an empty folder or a malformed page", () => {
    expect(versionedFrameSrc("s1", { kind: "site", page: "https://example.com", files: null })).toBe("https://example.com");
    expect(versionedFrameSrc("s1", { kind: "folder", page: "index.html", files: {} })).toBe("/api/a/s1/f/index.html");
    expect(versionedFrameSrc("s1", { kind: "blob", page: "blob:sha256:nope", files: null })).toBe("/api/a/s1/page");
  });
});
