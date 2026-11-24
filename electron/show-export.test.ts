// weft.showExport (electron/show-export.cjs): a page under show/ writes its piece and images to export/ beside it.
// The tests cover what makes it safe: only the pane's main frame on a show page, only names inside export/, copies
// only from beside the page, and the folder ends up exactly the files of the latest export.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_FILES, besidePage, cleanFiles, pageFolder, registerShowExport, writeExport } from "./show-export.cjs";

let dataDir: string, folder: string, page: string;

beforeEach(() => {
  dataDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "show-export-")));
  folder = path.join(dataDir, "show", "copy-edit", "essay");
  fs.mkdirSync(folder, { recursive: true });
  page = path.join(folder, "index.html");
  fs.writeFileSync(page, "<p>hi</p>");
  fs.writeFileSync(path.join(folder, "shot.png"), "PNG");
});
afterEach(() => fs.rmSync(dataDir, { recursive: true, force: true }));

function fakeIpc() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  return { handlers, ipcMain: { handle: (ch: string, fn: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(ch, fn) } };
}
function eventFor(url: string, { sub = false } = {}) {
  const mainFrame = { url };
  return { sender: { id: "pane", mainFrame }, senderFrame: sub ? { url } : mainFrame };
}
const piece = [{ name: "piece.md", text: "# Hi\n" }, { name: "images/01-cover.png", base64: Buffer.from("IMG").toString("base64") }];

describe("pageFolder", () => {
  it("is the page's folder for a file: page under show/", () => {
    expect(pageFolder(dataDir, pathToFileURL(page).href)).toBe(folder);
  });
  it("is null for a page elsewhere, a web page or a missing file", () => {
    const outside = path.join(dataDir, "elsewhere.html");
    fs.writeFileSync(outside, "x");
    expect(pageFolder(dataDir, pathToFileURL(outside).href)).toBeNull();
    expect(pageFolder(dataDir, "https://example.com/show/x.html")).toBeNull();
    expect(pageFolder(dataDir, pathToFileURL(path.join(folder, "gone.html")).href)).toBeNull();
  });
});

describe("besidePage", () => {
  it("finds a file beside the page by its relative src", () => {
    expect(besidePage(folder, "shot.png?v=2")).toBe(path.join(folder, "shot.png"));
  });
  it("refuses an absolute path, a url, a way out, the export folder or a missing file", () => {
    expect(besidePage(folder, path.join(folder, "shot.png"))).toBeNull();
    expect(besidePage(folder, "file:///etc/passwd")).toBeNull();
    expect(besidePage(folder, "../../../../etc/hosts")).toBeNull();
    expect(besidePage(folder, "nope.png")).toBeNull();
    expect(besidePage(folder, "")).toBeNull();
    fs.mkdirSync(path.join(folder, "export"));
    fs.writeFileSync(path.join(folder, "export", "a.png"), "x");
    expect(besidePage(folder, "export/a.png")).toBeNull();
  });
});

describe("cleanFiles", () => {
  it("takes text, base64 and a copy from beside the page", () => {
    const out = cleanFiles(folder, [...piece, { name: "images/02-shot.png", from: "shot.png" }]);
    expect(out.map((f) => f.body.toString())).toEqual(["# Hi\n", "IMG", "PNG"]);
  });
  it("refuses names outside export/ and its images/ folder, or of other types", () => {
    for (const name of ["../x.md", "a/b.png", "images/../../x.md", "run.sh", ".hidden.md", "images/sub/x.png", ""])
      expect(() => cleanFiles(folder, [{ name, text: "x" }])).toThrow(/isn't a name/);
  });
  it("refuses nothing, too many, an empty file and a copy from outside", () => {
    expect(() => cleanFiles(folder, [])).toThrow(/Nothing/);
    expect(() => cleanFiles(folder, "x")).toThrow(/Nothing/);
    expect(() => cleanFiles(folder, Array.from({ length: MAX_FILES + 1 }, (_, i) => ({ name: `${i}.md`, text: "" })))).toThrow(/At most/);
    expect(() => cleanFiles(folder, [{ name: "a.md" }])).toThrow(/nothing in it/);
    expect(() => cleanFiles(folder, [{ name: "a.png", from: "../../x.png" }])).toThrow(/beside this page/);
  });
  it("refuses an export over the size cap", () => {
    const big = "x".repeat(61 * 1024 * 1024);
    expect(() => cleanFiles(folder, [{ name: "a.md", text: big }])).toThrow(/too big/);
  });
});

describe("writeExport", () => {
  it("writes the files, then only what changed, and drops what the new export doesn't have", () => {
    const first = writeExport(folder, cleanFiles(folder, piece));
    expect(first).toMatchObject({ ok: true, files: 2, written: 2 });
    expect(fs.readFileSync(path.join(folder, "export", "piece.md"), "utf8")).toBe("# Hi\n");
    fs.writeFileSync(path.join(folder, "export", "notes-by-hand.sh"), "kept: not a name export writes");
    const second = writeExport(folder, cleanFiles(folder, [{ name: "piece.md", text: "# Hi\n" }]));
    expect(second.written).toBe(0);
    expect(fs.existsSync(path.join(folder, "export", "images", "01-cover.png"))).toBe(false);
    expect(fs.existsSync(path.join(folder, "export", "notes-by-hand.sh"))).toBe(true);
  });
});

describe("registerShowExport", () => {
  it("writes a show page's export beside it", async () => {
    const { handlers, ipcMain } = fakeIpc();
    registerShowExport(ipcMain, { owns: () => true, dataDir });
    const res = (await handlers.get("show-export:write")!(eventFor(pathToFileURL(page).href), piece)) as { ok: boolean; dir: string };
    expect(res).toMatchObject({ ok: true, dir: path.join(folder, "export") });
  });
  it("refuses a frame the pane doesn't own, or a subframe", async () => {
    const { handlers, ipcMain } = fakeIpc();
    registerShowExport(ipcMain, { owns: () => false, dataDir });
    await expect(handlers.get("show-export:write")!(eventFor(pathToFileURL(page).href), piece)).rejects.toThrow(/main frame/);
    const two = fakeIpc();
    registerShowExport(two.ipcMain, { owns: () => true, dataDir });
    await expect(two.handlers.get("show-export:write")!(eventFor(pathToFileURL(page).href, { sub: true }), piece)).rejects.toThrow(/main frame/);
  });
  it("refuses a page saved from a worker card", async () => {
    const { handlers, ipcMain } = fakeIpc();
    registerShowExport(ipcMain, { owns: () => true, dataDir });
    const worker = path.join(dataDir, "apps", "worker-abc", "index.html");
    fs.mkdirSync(path.dirname(worker), { recursive: true });
    fs.writeFileSync(worker, "x");
    await expect(handlers.get("show-export:write")!(eventFor(pathToFileURL(worker).href), piece)).rejects.toThrow();
  });
  it("answers why for a page outside show/ or a bad file", async () => {
    const { handlers, ipcMain } = fakeIpc();
    registerShowExport(ipcMain, { owns: () => true, dataDir });
    const handler = handlers.get("show-export:write")!;
    const web = (await handler(eventFor("https://example.com/"), piece)) as { ok: boolean; error: string };
    expect(web.ok).toBe(false);
    expect(web.error).toMatch(/show folder/);
    const bad = (await handler(eventFor(pathToFileURL(page).href), [{ name: "../x.md", text: "" }])) as { ok: boolean; error: string };
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/isn't a name/);
  });
});
