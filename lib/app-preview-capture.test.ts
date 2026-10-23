import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  blobPage as makeBlobPage,
  type CaptureState,
  emptyCaptureState,
  folderFixture as makeFolderFixture,
  folderPage as makeFolderPage,
  LONG_PAGE,
  sitePage as makeSitePage,
  stubSite,
} from "./app-preview-capture.test-helpers";

// lib/app-preview-capture.ts: the Mac's side of a shared mini app's link preview. The page's own meta
// tags, the folder's weft-app.json, a Haiku sentence when neither says what the app is, and a 1200×630
// capture from Electron's hidden window, uploaded as a blob into cloud_app_shares.preview.
//
// The shell (Electron's control server), Haiku and the blob store are mocked; the page is a real file on
// disk (or a stubbed fetch), and the row's write goes to a fake Supabase client. The fixtures and the
// Ready contexts live in ./app-preview-capture.test-helpers.

const state: CaptureState = vi.hoisted(() => ({
  shell: null,
  shellThrows: false,
  haiku: null,
  haikuThrows: false,
  uploaded: [],
  uploadRef: null,
  writes: [],
  pendingRow: {},
  writeError: null,
  writeThrows: null,
}));

vi.mock("./browser-tools", () => ({
  shell: vi.fn(() =>
    state.shellThrows ? Promise.reject(new Error("no desktop app")) : Promise.resolve(state.shell ?? {}),
  ),
}));

vi.mock("./haiku", () => ({
  complete: vi.fn(() =>
    state.haikuThrows ? Promise.reject(new Error("haiku is down")) : Promise.resolve(state.haiku ?? ""),
  ),
}));

vi.mock("./blob-store", () => ({
  createBlobStore: () => ({
    upload: vi.fn((p: string) => {
      state.uploaded.push(p);
      return Promise.resolve(state.uploadRef);
    }),
  }),
}));

// DATA_DIR is read from WEFT_DATA when ./store loads, so the temp dir has to be in place first.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-preview-capture-"));
process.env.WEFT_DATA = path.join(tmp, "data");

const { DATA_DIR } = await import("./store");
const { buildPreview, isPreviewing, previewKey, readPageHtml, refreshAppPreview, resolveImage, setPreviewDescription, shotPath } =
  await import("./app-preview-capture");
const { complete } = await import("./haiku");
const { shell } = await import("./browser-tools");

// The page builders need the mocked state, so they take it here.
const sitePage = (url?: string) => makeSitePage(state, url);
const blobPage = (local: string) => makeBlobPage(state, local);
const folderPage = (dir: string, entry?: string) => makeFolderPage(state, dir, entry);
const folderFixture = (manifest?: string) => makeFolderFixture(sandbox, manifest);

let sandbox: string;
beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(tmp, "case-"));
  Object.assign(state, emptyCaptureState());
  vi.mocked(shell).mockClear();
  vi.mocked(complete).mockClear();
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("previewKey and shotPath", () => {
  it("is the folder entry's sha, the site's address, or the blob ref", () => {
    expect(previewKey({ kind: "folder", page: "index.html", files: { "index.html": "abc" } })).toBe("abc");
    expect(previewKey({ kind: "folder", page: "index.html", files: null })).toBe("index.html");
    expect(previewKey({ kind: "folder", page: "index.html", files: {} })).toBe("index.html");
    expect(previewKey({ kind: "site", page: "https://example.com/app", files: null })).toBe("https://example.com/app");
    expect(previewKey({ kind: "blob", page: "blob:sha256:deadbeef", files: null })).toBe("blob:sha256:deadbeef");
  });

  it("keeps the capture in a png under the data dir, with the id's odd characters replaced", () => {
    expect(shotPath("app1")).toBe(path.join(DATA_DIR, "app-previews", "app1.png"));
    expect(shotPath("a/b c")).toBe(path.join(DATA_DIR, "app-previews", "a_b_c.png"));
  });
});

describe("readPageHtml", () => {
  it("reads a site's html", async () => {
    const fetchMock = stubSite("<h1>hello</h1>");
    expect(await readPageHtml(sitePage())).toContain("hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads nothing from a site that isn't html, that failed, or that says nothing about its type", async () => {
    stubSite("{}", "application/json");
    expect(await readPageHtml(sitePage())).toBe("");

    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("dns"))));
    expect(await readPageHtml(sitePage())).toBe("");

    const noType = vi.fn(() => {
      const res = new Response("<h1>hi</h1>", { headers: { "content-type": "text/html" } });
      res.headers.delete("content-type");
      return Promise.resolve(res);
    });
    vi.stubGlobal("fetch", noType);
    expect(await readPageHtml(sitePage())).toBe("");
  });

  it("reads a folder's entry file, and a blob's local file", async () => {
    const folder = folderFixture();
    fs.writeFileSync(path.join(folder, "index.html"), "<h1>folder</h1>");
    expect(await readPageHtml(folderPage(folder))).toContain("folder");

    const file = path.join(sandbox, "page.html");
    fs.writeFileSync(file, "<h1>blob</h1>");
    expect(await readPageHtml(blobPage(file))).toContain("blob");
  });

  it("reads nothing from a file that isn't there, or is too big", async () => {
    expect(await readPageHtml(blobPage(path.join(sandbox, "gone.html")))).toBe("");
    const big = path.join(sandbox, "big.html");
    fs.writeFileSync(big, "x".repeat(2 * 1024 * 1024 + 1));
    expect(await readPageHtml(blobPage(big))).toBe("");
  });
});

describe("resolveImage", () => {
  const sha = "a".repeat(64);

  it("keeps an absolute https address, and makes a protocol-relative one absolute", () => {
    expect(resolveImage("https://cdn.example.com/a.png", sitePage(), null)).toBe("https://cdn.example.com/a.png");
    expect(resolveImage("//cdn.example.com/a.png", sitePage(), null)).toBe("https://cdn.example.com/a.png");
  });

  it("resolves a site's relative path against the site, and drops one it can't resolve", () => {
    expect(resolveImage("/a.png", sitePage("https://example.com/dir/app"), null)).toBe("https://example.com/a.png");
    expect(resolveImage("a.png", sitePage("not a url"), null)).toBeUndefined();
  });

  it("turns a folder's relative picture into its blob ref", () => {
    expect(resolveImage("assets/a.png", folderPage("/tmp/app"), { "assets/a.png": sha })).toBe(`blob:sha256:${sha}`);
    expect(resolveImage("./assets/a.png", folderPage("/tmp/app"), { "assets/a.png": sha })).toBe(`blob:sha256:${sha}`);
  });

  it("refuses a path that climbs out of the folder, and a name that isn't a picture", () => {
    expect(resolveImage("../outside.png", folderPage("/tmp/app"), { "../outside.png": sha })).toBeUndefined();
    expect(resolveImage("notes.txt", folderPage("/tmp/app"), { "notes.txt": sha })).toBeUndefined();
  });

  it("drops a blob kind's relative name, and nothing at all", () => {
    expect(resolveImage("a.png", blobPage("/tmp/page.html"), { "a.png": "b" })).toBeUndefined();
    expect(resolveImage(undefined, sitePage(), null)).toBeUndefined();
  });
});

describe("buildPreview", () => {
  const now = { kind: "site", page: "https://example.com/app", files: null };

  it("takes the page's own description and never asks Haiku", async () => {
    stubSite('<meta property="og:description" content="A page about growth."><p>text</p>');
    const preview = await buildPreview(sitePage(), now, "o1", null);
    expect(preview.description).toBe("A page about growth.");
    expect(preview.by?.description).toBe("page");
    expect(complete).not.toHaveBeenCalled();
  });

  it("asks Haiku when nothing else says what the app is", async () => {
    state.haiku = "It shows the growth of a small product.";
    stubSite(LONG_PAGE);
    const preview = await buildPreview(sitePage(), now, "o1", null);
    expect(preview.description).toBe("It shows the growth of a small product.");
    expect(preview.by?.description).toBe("weft");
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("doesn't ask Haiku when the page says too little, and survives Haiku failing", async () => {
    stubSite("<p>short</p>");
    expect((await buildPreview(sitePage(), now, "o1", null)).description).toBeUndefined();
    expect(complete).not.toHaveBeenCalled();

    state.haikuThrows = true;
    stubSite(LONG_PAGE);
    expect((await buildPreview(sitePage(), now, "o1", null)).description).toBeUndefined();
  });

  it("keeps your own description over the page's and Haiku's", async () => {
    state.haiku = "It shows the growth of a small product.";
    stubSite('<meta property="og:description" content="The page says this."><p>text</p>');
    const preview = await buildPreview(sitePage(), now, "o1", { description: "What I typed.", by: { description: "you" } });
    expect(preview.description).toBe("What I typed.");
    expect(preview.by?.description).toBe("you");
    expect(complete).not.toHaveBeenCalled();
  });

  it("doesn't capture a picture when the page or the app names one", async () => {
    stubSite('<meta property="og:image" content="https://cdn.example.com/a.png"><p>text</p>');
    const preview = await buildPreview(sitePage(), now, "o1", null);
    expect(preview.image).toBe("https://cdn.example.com/a.png");
    expect(preview.shot).toBeUndefined();
    expect(shell).not.toHaveBeenCalled();
  });

  it("captures, saves and uploads a picture when nothing else names one", async () => {
    state.shell = { png: Buffer.from("png-bytes").toString("base64") };
    state.uploadRef = `blob:sha256:${"b".repeat(64)}`;
    stubSite(LONG_PAGE);
    const preview = await buildPreview(sitePage(), now, "o1", null);
    expect(shell).toHaveBeenCalledWith("/page/snapshot", { url: "https://example.com/app", width: 1200, height: 630 });
    const file = shotPath("app1");
    expect(fs.readFileSync(file, "utf8")).toBe("png-bytes");
    expect(state.uploaded).toEqual([file]);
    expect(preview.shot).toBe(`blob:sha256:${"b".repeat(64)}`);
  });

  it("keeps going when the capture fails, or when the upload got nothing", async () => {
    state.shellThrows = true;
    stubSite(LONG_PAGE);
    expect((await buildPreview(sitePage(), now, "o1", null)).shot).toBeUndefined();

    state.shellThrows = false;
    state.shell = { png: Buffer.from("png-bytes").toString("base64") };
    state.uploadRef = null;
    stubSite(LONG_PAGE);
    const preview = await buildPreview(sitePage(), now, "o1", null);
    expect(state.uploaded).toHaveLength(1);
    expect(preview.shot).toBeUndefined();
  });

  it("takes the folder's own weft-app.json fields over the page's", async () => {
    const folder = folderFixture(JSON.stringify({
      title: "From the app", description: "The app's own words.", image: "https://cdn.example.com/a.png",
    }));
    const preview = await buildPreview(folderPage(folder), { kind: "folder", page: "index.html", files: null }, "o1", null);
    expect(preview.title).toBe("From the app");
    expect(preview.description).toBe("The app's own words.");
    expect(preview.by?.description).toBe("app");
    expect(preview.image).toBe("https://cdn.example.com/a.png");
  });

  it("keeps going when weft-app.json isn't there, or isn't json", async () => {
    const folder = folderFixture();
    const none = await buildPreview(folderPage(folder), { kind: "folder", page: "index.html", files: null }, "o1", null);
    expect(none.by?.description).toBeUndefined();

    fs.writeFileSync(path.join(folder, "weft-app.json"), "{not json");
    const broken = await buildPreview(folderPage(folder), { kind: "folder", page: "index.html", files: null }, "o1", null);
    expect(broken.by?.description).toBeUndefined();
  });
});

describe("refreshAppPreview", () => {
  const now = { kind: "site", page: "https://example.com/app", files: null };

  it("skips a page that hasn't changed since the last preview", async () => {
    const fetchMock = stubSite("<p>text</p>");
    await refreshAppPreview(sitePage(), { id: "row1", preview: { of: "https://example.com/app" } }, now);
    expect(state.writes).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("makes one when the page changed, and one even when it didn't, when asked", async () => {
    stubSite("<p>text</p>");
    await refreshAppPreview(sitePage(), { id: "row1", preview: { of: "https://example.com/other" } }, now);
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0]?.filters).toEqual({ id: "row1" });

    state.writes = [];
    await refreshAppPreview(sitePage(), { id: "row1", preview: { of: "https://example.com/app" } }, now, true);
    expect(state.writes).toHaveLength(1);
  });

  it("runs one at a time per app: a second call while the first runs waits", async () => {
    let release: (response: Response) => void = () => {};
    const fetchMock = vi.fn(() => {
      const blocked = new Promise<Response>((r) => {
        release = r;
      });
      return blocked.then(() => new Response("<p>text</p>", { headers: { "content-type": "text/html" } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const first = refreshAppPreview(sitePage(), { id: "row1" }, now);
    await vi.waitFor(() => expect(isPreviewing("app1")).toBe(true));
    const second = refreshAppPreview(sitePage(), { id: "row1" }, now);
    release(new Response(""));
    await first;
    release(new Response(""));
    await second;
    expect(isPreviewing("app1")).toBe(false);
  });

  it("logs a failed write instead of throwing", async () => {
    state.writeError = { message: "rls" };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    stubSite("<p>text</p>");
    await expect(refreshAppPreview(sitePage(), { id: "row1" }, now)).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("rls"));
    errors.mockRestore();
    expect(isPreviewing("app1")).toBe(false);
  });

  it("logs a failure that isn't an Error the same way", async () => {
    state.writeThrows = "just a string";
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    stubSite("<p>text</p>");
    await expect(refreshAppPreview(sitePage(), { id: "row1" }, now)).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("just a string"));
    errors.mockRestore();
  });
});

describe("setPreviewDescription", () => {
  const now = { kind: "site", page: "https://example.com/app", files: null };

  it("saves what you typed, and says you wrote it", async () => {
    await setPreviewDescription(sitePage(), { id: "row1" }, now, "  My own words.  ");
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0]?.row).toMatchObject({ preview: { description: "My own words.", by: { description: "you" } } });
  });

  it("clears your words and hands it back to the page, making a fresh preview", async () => {
    const fetchMock = stubSite("<p>text</p>");
    await setPreviewDescription(
      sitePage(),
      { id: "row1", preview: { description: "Old words.", by: { description: "you" } } },
      now,
      "",
    );
    expect(state.writes[0]?.row).toMatchObject({ preview: { description: undefined, by: { description: undefined } } });
    // The clear is written first, then the fresh preview is made and written again.
    await vi.waitFor(() => expect(state.writes.length).toBeGreaterThanOrEqual(2));
    expect(fetchMock).toHaveBeenCalled();
  });
});
