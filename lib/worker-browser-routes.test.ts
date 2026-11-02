// The worker's /browser/* routes over a fake page (lib/worker-browser-routes.ts): navigation and its refusals, text,
// screenshots, the routes a worker answers or refuses itself, and pane-input's own routes on the adapter. The real
// Chromium run is lib/worker-browser.real.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeCdp } from "./worker-browser.harness";
import { browserPage, type BrowserPage } from "./worker-browser-page";

const pages = vi.hoisted(() => new Map<string, unknown>());
vi.mock("./worker-browser", () => ({
  pageFor: (key: string) => Promise.resolve(pages.get(key)),
  existingPage: (key: string) => pages.get(key) ?? null,
}));
const screen = vi.hoisted(() => ({ showLive: vi.fn(() => Promise.resolve()), paneMovedOn: vi.fn() }));
vi.mock("./worker-browser-screen", () => screen);
vi.mock("./worker-browser-guard", async (load) => ({ ...(await load<typeof import("./worker-browser-guard")>()), mayLoad: (url: string) => !url.includes("secret") && !url.startsWith("chrome:") && url !== "https://" }));

const r = await import("./worker-browser-routes");

let cdp: ReturnType<typeof fakeCdp>;
let page: BrowserPage;
let href = "https://a.test/";

beforeEach(() => {
  vi.clearAllMocks();
  href = "https://a.test/";
  cdp = fakeCdp({
    "Page.navigate": (p: { url: string }) => {
      href = p.url;
      setTimeout(() => cdp.emit({ method: "Page.loadEventFired", params: {}, sessionId: "s1" }), 1);
      return {};
    },
    "Runtime.evaluate": (p: { expression: string }) => {
      if (p.expression.includes("location.href")) return { result: { value: { url: href, title: "A page" } } };
      if (p.expression.includes("innerText")) return { result: { value: "x".repeat(40_000) } };
      return { result: { value: true } };
    },
    "Page.captureScreenshot": { data: "iVBORw0KGgo=" },
  });
  page = browserPage(cdp, "c1", "T", "s1");
  pages.clear();
  pages.set("c1", page);
});

const call = (route: string, body: Record<string, unknown> = {}) => r.workerShell(route, { key: "c1", ...body });

describe("/browser/open", () => {
  it("navigates, waits for the load, and shows a site live", async () => {
    expect(await call("/browser/open", { url: "example.com" })).toEqual({ url: "https://example.com", title: "A page" });
    expect(screen.showLive).toHaveBeenCalledWith("c1");
    expect(screen.paneMovedOn).not.toHaveBeenCalled();
  });

  it("leaves the pane on a page the card wrote, until the next act", async () => {
    expect(await call("/browser/open", { url: "/show/plan.html" })).toMatchObject({ url: "file:///show/plan.html" });
    expect(screen.paneMovedOn).toHaveBeenCalledWith("c1");
    expect(screen.showLive).not.toHaveBeenCalled();
  });

  it("refuses what the guard refuses, before and after the browser tries", async () => {
    await expect(call("/browser/open", { url: "/home/secret.html" })).rejects.toThrow(/Can't open file:\/\/\/home\/secret.html/);
    await expect(call("/browser/open")).rejects.toThrow(/Can't open https:\/\//);
    await expect(call("/browser/open", { url: "chrome://settings" })).rejects.toThrow(/http, https and allowed files only/);
    cdp.answers["Page.navigate"] = { errorText: "net::ERR_ACCESS_DENIED" };
    await expect(call("/browser/open", { url: "/show/link.html" })).rejects.toThrow(/Can't open/);
    expect(cdp.sent.filter((s) => s.method === "Page.navigate")).toHaveLength(1);
  });

  it("says why a page didn't open, and takes an aborted load (a redirect, a download) as opened", async () => {
    cdp.answers["Page.navigate"] = { errorText: "net::ERR_CONNECTION_REFUSED" };
    await expect(call("/browser/open", { url: "http://localhost:3000" })).rejects.toThrow("Couldn't open http://localhost:3000: net::ERR_CONNECTION_REFUSED");
    cdp.answers["Page.navigate"] = { errorText: "net::ERR_ABORTED" };
    await expect(call("/browser/open", { url: "http://localhost:3000" })).resolves.toMatchObject({ title: "A page" });
  });

  it("needs a card: a thread with none would share one page with every other", async () => {
    await expect(r.workerShell("/browser/open", { url: "https://a.test/" })).rejects.toThrow(r.NO_CARD);
    await expect(r.workerShell("/browser/text", { key: "" })).rejects.toThrow(r.NO_CARD);
  });

  it("stops waiting for a page that never finishes loading", async () => {
    cdp.answers["Page.navigate"] = {};
    await expect(r.navigate("c1", "https://slow.test", 5)).resolves.toMatchObject({ title: "A page" });
  });
});

describe("the reading routes", () => {
  it("say there's no page before open_url", async () => {
    pages.clear();
    for (const route of ["/browser/text", "/browser/screenshot", "/browser/snapshot", "/browser/console"]) await expect(call(route)).rejects.toThrow(r.NO_PAGE);
    expect(await call("/browser/url")).toEqual({ url: "" });
  });

  it("read the page's text, capped, and its URL", async () => {
    const text = await call("/browser/text");
    expect(text).toMatchObject({ url: "https://a.test/", title: "A page" });
    expect(String(text.text)).toHaveLength(30_000);
    await page.refresh();
    expect(await call("/browser/url")).toEqual({ url: "https://a.test/" });
    cdp.answers["Runtime.evaluate"] = (p: { expression: string }) => (p.expression.includes("innerText") ? {} : { result: { value: { url: href, title: "" } } });
    expect((await call("/browser/text")).text).toBe("");
  });

  it("take a screenshot, boxing and unboxing what highlight names", async () => {
    expect(await call("/browser/screenshot")).toEqual({ png: "iVBORw0KGgo=" });
    expect(await call("/browser/screenshot", { highlight: "#go" })).toEqual({ png: "iVBORw0KGgo=", found: true });
    expect(cdp.sent.map((s) => String(s.params.expression))).toContain(`document.getElementById("__weft_highlight")?.remove()`);
    cdp.answers["Runtime.evaluate"] = new Error("no page script");
    expect(await call("/browser/screenshot", { highlight: "#go" })).toEqual({ png: "iVBORw0KGgo=", found: false });
  });
});

describe("what a worker answers itself", () => {
  it("has no thumbnail, refuses fill_field by name, and sends the rest back to the desktop", async () => {
    expect(await call("/browser/thumb")).toEqual({ jpg: null });
    expect(await r.workerShell("/browser/url")).toEqual({ url: "" });
    await expect(call("/secrets/fill")).rejects.toThrow(r.FILL_REFUSAL);
    await expect(r.workerShell("/browser/nope")).rejects.toThrow("/browser/nope needs the desktop app; this card runs on a Weft Worker.");
  });
});

describe("pane-input's routes on the worker's page", () => {
  it("reads the console through the same buffers as the pane, and doesn't go live for a read", async () => {
    await call("/browser/open", { url: "https://a.test/" });
    vi.clearAllMocks();
    cdp.emit({ method: "Runtime.consoleAPICalled", params: { type: "error", args: [{ type: "string", value: "boom" }] }, sessionId: "s1" });
    expect(await call("/browser/console", { level: "error" })).toEqual({ entries: [expect.objectContaining({ level: "error", text: "boom" })] });
    expect(await call("/browser/network")).toEqual({ entries: [] });
    expect(screen.showLive).not.toHaveBeenCalled();
  });

  it("puts the pane on the live view after an act", async () => {
    cdp.answers["Runtime.evaluate"] = (p: { expression: string }) => ({ result: { value: p.expression.includes("location.href") ? { url: href, title: "" } : { width: 390, height: 844 } } });
    expect(await call("/browser/viewport", { size: "phone" })).toEqual({ width: 390, height: 844 });
    expect(screen.showLive).toHaveBeenCalledWith("c1");
    // The act happened even when the live view can't start, so it isn't reported (and retried) as failed.
    screen.showLive.mockImplementationOnce(() => Promise.reject(new Error("Couldn't reach the live view's channel.")));
    expect(await call("/browser/viewport", { size: "phone" })).toEqual({ width: 390, height: 844 });
  });
});
