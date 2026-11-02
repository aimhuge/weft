// The worker's browser against a real headless Chromium: the shell routes the browser tools call, the file guard, and
// the live view's frames and input. Skipped, saying why, when this machine has no Chromium to launch
// (lib/worker-chromium.ts findChromium: WEFT_CHROMIUM, ~/.weft/tools/chromium, Playwright's cache, the system's Chrome).
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { findChromium, launchChromium } from "./worker-chromium";

const noted: Array<[string | undefined, string]> = [];
vi.mock("./card-page", () => ({ notePage: (card: string | undefined, url: string) => void noted.push([card, url]) }));

const bin = findChromium();
const reason = bin ? "" : "no Chromium on this machine (set WEFT_CHROMIUM, or install Playwright's chromium-headless-shell)";
if (reason) console.warn(`worker-browser.real.test.ts skipped: ${reason}`);

const PAGE = `<!doctype html><meta name="viewport" content="width=device-width"><title>Test page</title>
<button id="menu">Open menu</button><div id="out"></div>
<form id="f"><input id="name" aria-label="Name"><select id="pick" aria-label="Pick"><option value="a">Apple</option><option value="b">Banana</option></select></form>
<div style="height:3000px"></div>
<script>
document.getElementById("menu").addEventListener("pointerdown", (e) => { document.getElementById("out").textContent = e.isTrusted ? "menu open" : "untrusted"; });
document.getElementById("f").addEventListener("submit", (e) => { e.preventDefault(); document.getElementById("out").textContent = "sent " + document.getElementById("name").value; });
console.error("boom from the page");
fetch("/missing");
</script>`;

let base: string;
let wh: string;
let show: string;
let server: http.Server;
let origin: string;
type Shell = typeof import("./worker-browser-routes");
let routes: Shell;
let screen: typeof import("./worker-browser-screen");
let browser: typeof import("./worker-browser");
const call = (route: string, body: Record<string, unknown> = {}) => routes.workerShell(route, { key: "card-1", ...body });

beforeAll(async () => {
  if (reason) return;
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wb-")));
  wh = path.join(base, ".weft-worker");
  show = path.join(wh, "data", "show");
  fs.mkdirSync(show, { recursive: true });
  fs.mkdirSync(path.join(wh, "work"), { recursive: true });
  fs.writeFileSync(path.join(wh, "worker.json"), '{"key":"wwk_secret"}');
  fs.writeFileSync(path.join(show, "worker.html"), "<p>secret</p>");
  fs.writeFileSync(path.join(show, "plan.html"), `<title>Plan</title><h1>The plan</h1><iframe src="file://${path.join(wh, "worker.json")}"></iframe>`);
  fs.symlinkSync(path.join(wh, "worker.json"), path.join(show, "link.html"));
  vi.stubEnv("WEFT_WORKER_HOME", wh);
  vi.stubEnv("WEFT_WORKER_ROOT", "");
  vi.stubEnv("WEFT_DATA", path.join(wh, "data"));
  vi.spyOn(os, "homedir").mockReturnValue(base);
  server = http.createServer((req, res) => {
    if (req.url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
    res.writeHead(404).end("nope");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await import("./worker-browser");
  browser.setBrowserLauncher(() => launchChromium(bin));
  routes = await import("./worker-browser-routes");
  screen = await import("./worker-browser-screen");
}, 30_000);

afterAll(() => {
  if (reason) return;
  browser.stopBrowser();
  server.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(base, { recursive: true, force: true });
});

describe.skipIf(!!reason)("a worker card's browser tools, in a real Chromium", () => {
  const frames: Buffer[] = [];

  // The first call cold-starts Chromium; a loaded CI shard has taken over 30s for that.
  it("opens a dev server on localhost and reads it", async () => {
    screen.setBrowserScreenChannel(() => Promise.resolve({ send: (f) => (frames.push(f.bytes), Promise.resolve()), type: () => "jpeg", answer: () => Promise.resolve(), close: () => {} }));
    expect(await call("/browser/open", { url: `${origin}/` })).toEqual({ url: `${origin}/`, title: "Test page" });
    const page = await call("/browser/text");
    expect(page.text).toContain("Open menu");
    expect(await call("/browser/url")).toEqual({ url: `${origin}/` });
    // The pane now names the card's live view.
    expect(noted.at(-1)?.[1]).toMatch(/^weft-screen:[0-9a-f]{32}\?.*device=browser-[0-9a-f]{16}/);
  }, 90_000);

  it("snapshots with refs, and clicks, types, submits and selects with trusted input", async () => {
    const snap = await call("/browser/snapshot");
    const ref = /button "Open menu" \[ref=(e\d+)\]/.exec(String(snap.text))?.[1];
    expect(ref).toBeTruthy();
    await call("/browser/click", { ref });
    await call("/browser/wait", { text: "menu open", timeout: 3000 });
    await call("/browser/type", { selector: "#name", text: "Ada", submit: true });
    await call("/browser/wait", { text: "sent Ada", timeout: 3000 });
    expect(await call("/browser/select", { selector: "#pick", values: ["Banana"] })).toEqual({ picked: ["Banana"] });
    expect(await call("/browser/press", { keys: "Tab" })).toEqual({ pressed: "Tab" });
  }, 30_000);

  it("scrolls, changes the viewport, and takes a screenshot", async () => {
    await call("/browser/scroll", { direction: "down", amount: 500 });
    // The wheel lands a frame or two later on a slow run; a nudge reads where it got to.
    await vi.waitFor(async () => expect((await call("/browser/scroll", { direction: "down", amount: 1 })).scrollY).toBeGreaterThan(0), { timeout: 3000 });
    expect(await call("/browser/viewport", { size: "phone" })).toEqual({ width: 390, height: 844 });
    await call("/browser/viewport", { size: "desktop" });
    const shot = await call("/browser/screenshot", { highlight: "#menu" });
    expect(String(shot.png).startsWith("iVBORw0KGgo")).toBe(true);
    expect(shot.found).toBe(true);
  }, 30_000);

  it("keeps the page's console and failed requests", async () => {
    const logs = (await call("/browser/console", {})).entries as Array<{ text: string }>;
    expect(logs.map((e) => e.text)).toContain("boom from the page");
    const failed = (await call("/browser/network", {})).entries as Array<{ status: number; url: string }>;
    expect(failed).toContainEqual(expect.objectContaining({ status: 404, url: `${origin}/missing` }));
  }, 30_000);

  it("streams the page as JPEG frames, and a tap from the pane clicks it", async () => {
    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0), { timeout: 5000 });
    expect(frames[0]?.subarray(0, 2).toString("hex")).toBe("ffd8");
    const device = screen.browserDevice("card-1");
    expect(screen.browserWatcherOf(device)).toBe("card-1");
    await call("/browser/open", { url: `${origin}/` });
    await expect(screen.browserInput({ kind: "tap", device, x: 0.02, y: 0.015 }, "card-1")).resolves.toMatch(/^click /);
    await call("/browser/wait", { text: "menu open", timeout: 3000 });
    await expect(screen.browserInput({ kind: "swipe", device, x: 0.5, y: 0.8, x2: 0.5, y2: 0.2 }, "card-1")).resolves.toMatch(/^scroll 0,[1-9]\d+$/);
    const sent: Buffer[] = [];
    const listeners: Array<(raw: Buffer) => void> = [];
    const fast = screen.browserScreenOf(device);
    fast?.input?.({ label: `input:${device}:00112233`, send: (b: Buffer) => void sent.push(b), bufferedAmount: 0, onMessage: { subscribe: (fn: (raw: Buffer) => void) => listeners.push(fn) }, stateChanged: { subscribe: () => {} } } as never);
    // The newest frame goes out at once, length-prefixed.
    expect(sent.length).toBeGreaterThan(0);
    // The board's live keys, as HID usages, type into the focused field.
    await call("/browser/scroll", { selector: "#name" });
    await call("/browser/type", { selector: "#name", text: "" });
    const live = (event: object) => listeners.forEach((l) => l(Buffer.from(JSON.stringify(event))));
    live({ t: "key", code: 225, down: true });
    live({ t: "key", code: 11, down: true });
    live({ t: "key", code: 11, down: false });
    live({ t: "key", code: 225, down: false });
    live({ t: "key", code: 12, down: true });
    await vi.waitFor(async () => expect(String((await call("/browser/snapshot")).text)).toMatch(/textbox "Name" .*: "Hi"/), { timeout: 3000 });
  }, 30_000);

  it("opens a page in the show folder, but never a secret, a link to one, or a file a page frames", async () => {
    expect(await call("/browser/open", { url: path.join(show, "plan.html") })).toEqual({ url: `file://${path.join(show, "plan.html")}`, title: "Plan" });
    const failed = (await call("/browser/network", {})).entries as Array<{ url: string; error?: string }>;
    expect(failed).toContainEqual(expect.objectContaining({ url: `file://${path.join(wh, "worker.json")}`, error: "net::ERR_ACCESS_DENIED" }));
    await expect(call("/browser/open", { url: path.join(wh, "worker.json") })).rejects.toThrow(/Can't open/);
    await expect(call("/browser/open", { url: path.join(show, "link.html") })).rejects.toThrow(/Can't open/);
    await expect(call("/browser/open", { url: "chrome://settings" })).rejects.toThrow(/Can't open/);
  }, 30_000);

  it("keeps cards apart: another card's page has its own context", async () => {
    await expect(routes.workerShell("/browser/text", { key: "card-2" })).rejects.toThrow(routes.NO_PAGE);
    await routes.workerShell("/browser/open", { key: "card-2", url: path.join(show, "plan.html") });
    expect((await call("/browser/url")).url).toBe(`file://${path.join(show, "plan.html")}`);
    browser.closePage("card-2");
    await expect(routes.workerShell("/browser/text", { key: "card-2" })).rejects.toThrow(routes.NO_PAGE);
  }, 30_000);
});
