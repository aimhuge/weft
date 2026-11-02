import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ dir: "" }));
h.dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-worker-app-"));
vi.mock("./store", () => ({
  get DATA_DIR() {
    return h.dir;
  },
}));
// The default read: the account's session and the blob store, each mocked.
const reads = vi.hoisted(() => ({
  accountClient: vi.fn(() => ({ client: true })),
  requireSession: vi.fn(() => Promise.resolve({ uid: "u1", org: "org-1" })),
  readBlob: vi.fn(() => Promise.resolve({ bytes: new TextEncoder().encode("<title>From store</title>"), type: "text/html; charset=utf-8" })),
}));
vi.mock("./account", () => ({ accountClient: reads.accountClient }));
vi.mock("./worker-board", () => ({ requireSession: reads.requireSession }));
vi.mock("./blob-read", () => ({ readBlob: reads.readBlob }));

const { MAX_WORKER_PAGE_BYTES, saveWorkerPageApp } = await import("./mini-app-worker");
const { listApps } = await import("./mini-app-store");

const shaOf = (body: string | Uint8Array) => createHash("sha256").update(body).digest("hex");
const STORE_BODY = "<title>From store</title>";
const SHA = shaOf("<html><title> Burndown </title></html>");
const pageOf = (body: string) => `blob:sha256:${shaOf(body)}#top`;
const PAGE = `blob:sha256:${SHA}#top`;
const html = (body: string) => () => Promise.resolve({ bytes: new TextEncoder().encode(body), type: "text/html; charset=utf-8" });
const file = (sha = SHA) => path.join(h.dir, "apps", `worker-${sha.slice(0, 16)}`, "index.html");

beforeEach(() => fs.rmSync(path.join(h.dir, "apps.json"), { force: true }));
afterAll(() => fs.rmSync(h.dir, { recursive: true, force: true }));

describe("saveWorkerPageApp", () => {
  it("brings the page home and saves it as an app that remembers the blob it came from", async () => {
    const app = await saveWorkerPageApp(PAGE, "  ", html("<html><title> Burndown </title></html>"), h.dir);
    expect(fs.readFileSync(file(), "utf8")).toBe("<html><title> Burndown </title></html>");
    expect(app).toMatchObject({ name: "Burndown", url: pathToFileURL(file()).href, source: `blob:sha256:${SHA}` });
    expect(listApps()).toEqual([app]);
  });

  it("takes the name given, else a plain one when the page has no title", async () => {
    expect((await saveWorkerPageApp(pageOf("<p>hi</p>"), "Report", html("<p>hi</p>"), h.dir)).name).toBe("Report");
    fs.rmSync(path.join(h.dir, "apps.json"));
    expect((await saveWorkerPageApp(pageOf("<p>hi</p>"), undefined, html("<p>hi</p>"), h.dir)).name).toBe("Worker page");
  });

  it("refuses another address, a page that's gone, and a file that isn't a page", async () => {
    await expect(saveWorkerPageApp("https://example.com", "x", html(""), h.dir)).rejects.toThrow("isn't a page a worker card showed");
    await expect(saveWorkerPageApp(PAGE, "x", () => Promise.resolve(null), h.dir)).rejects.toThrow("isn't in your workspace's store");
    await expect(saveWorkerPageApp(PAGE, "x", () => Promise.resolve({ bytes: new Uint8Array(1), type: "image/png" }), h.dir)).rejects.toThrow("Only a web page");
  });

  it("reads the page with the account's session by default", async () => {
    const app = await saveWorkerPageApp(pageOf(STORE_BODY), undefined);
    expect(app.name).toBe("From store");
    expect(reads.readBlob).toHaveBeenCalledWith({ client: true }, "org-1", shaOf(STORE_BODY), { r2: null });
  });

  it("refuses bytes that aren't the page its address names, and a page too big to be one", async () => {
    await expect(saveWorkerPageApp(PAGE, "x", html("<script>swapped()</script>"), h.dir)).rejects.toThrow("don't match its address");
    const big = new Uint8Array(MAX_WORKER_PAGE_BYTES + 1);
    const read = () => Promise.resolve({ bytes: big, type: "text/html" });
    await expect(saveWorkerPageApp(`blob:sha256:${shaOf(big)}`, "x", read, h.dir)).rejects.toThrow("too big");
    expect(fs.existsSync(file(shaOf(big)))).toBe(false);
    const body = "<p>buffer</p>";
    const buffer = () => Promise.resolve({ bytes: new TextEncoder().encode(body).buffer, type: "text/html" });
    expect((await saveWorkerPageApp(pageOf(body), "Buffer", buffer, h.dir)).name).toBe("Buffer");
  });
});
