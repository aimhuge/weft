// lib/app-preview-capture.ts's resolveImage: the picture a page or weft-app.json names, as the row may hold it —
// https as it is, a site's relative path against the site, a folder's own image file by its blob. Anything else
// (a Mac path, data:, http) is dropped.

import { describe, expect, it } from "vitest";

const { resolveImage } = await import("./app-preview-capture");

// resolveImage is pure: it reads the page off the Ready and never touches the client. The three page kinds
// it has to tell apart.
const ready = (page: unknown) => ({ client: {}, orgId: "o1", userId: "u1", app: { id: "a1", name: "App" }, page }) as never;
const site = (url = "https://example.com/app") => ready({ kind: "site", url });
const folder = (dir: string) => ready({ kind: "folder", folder: dir, entry: "index.html", files: [], manifest: {} });
const blob = (local: string) => ready({ kind: "blob", local, hash: "" });

describe("resolveImage", () => {
  const sha = "a".repeat(64);

  it("keeps an absolute https address, and makes a protocol-relative one absolute", () => {
    expect(resolveImage("https://cdn.example.com/a.png", site(), null)).toBe("https://cdn.example.com/a.png");
    expect(resolveImage("//cdn.example.com/a.png", site(), null)).toBe("https://cdn.example.com/a.png");
  });

  it("resolves a site's relative path against the site, and drops one it can't resolve", () => {
    expect(resolveImage("/a.png", site("https://example.com/dir/app"), null)).toBe("https://example.com/a.png");
    expect(resolveImage("a.png", site("not a url"), null)).toBeUndefined();
  });

  it("turns a folder's relative picture into its blob ref", () => {
    expect(resolveImage("assets/a.png", folder("/tmp/app"), { "assets/a.png": sha })).toBe(`blob:sha256:${sha}`);
    expect(resolveImage("./assets/a.png", folder("/tmp/app"), { "assets/a.png": sha })).toBe(`blob:sha256:${sha}`);
  });

  it("refuses a path that climbs out of the folder, and a name that isn't a picture", () => {
    expect(resolveImage("../outside.png", folder("/tmp/app"), { "../outside.png": sha })).toBeUndefined();
    expect(resolveImage("notes.txt", folder("/tmp/app"), { "notes.txt": sha })).toBeUndefined();
  });

  it("drops a blob kind's relative name, and nothing at all", () => {
    expect(resolveImage("a.png", blob("/tmp/page.html"), { "a.png": "b" })).toBeUndefined();
    expect(resolveImage(undefined, site(), null)).toBeUndefined();
  });
});
