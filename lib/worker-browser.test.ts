// The worker's browser with a fake DevTools connection: a context and a page per card, the file guard on every
// session, popups closed, and idle pages and the browser closed (lib/worker-browser.ts). The real Chromium run is
// lib/worker-browser.real.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeCdp, flush, sentOf } from "./worker-browser.harness";

const guard = vi.hoisted(() => ({ mayLoad: vi.fn((url: string) => !url.includes("secret")) }));
vi.mock("./worker-browser-guard", () => guard);
// The browser it starts by default; a test that needs another hands it in with setBrowserLauncher.
const launched = vi.hoisted(() => ({ make: (): unknown => null }));
vi.mock("./worker-chromium", async (load) => ({ ...(await load<typeof import("./worker-chromium")>()), launchChromium: () => launched.make() }));

const wb = await import("./worker-browser");
let cdp: ReturnType<typeof fakeCdp>;
let n = 0;

function newCdp() {
  n++;
  cdp = fakeCdp({
    "Target.createBrowserContext": { browserContextId: `ctx${n}` },
    "Target.createTarget": () => ({ targetId: `t${n}-${sentOf(cdp, "Target.createTarget").length}` }),
    "Target.attachToTarget": (p: { targetId: string }) => ({ sessionId: `s-${p.targetId}` }),
  });
  return cdp;
}

beforeEach(() => {
  vi.useFakeTimers();
  launched.make = newCdp;
});
afterEach(() => {
  wb.stopBrowser();
  vi.useRealTimers();
});

describe("pageFor", () => {
  it("starts the browser once, with downloads refused, and gives each card its own context and guarded page", async () => {
    const [a, again] = await Promise.all([wb.pageFor("a"), wb.pageFor("a")]);
    expect(again).toBe(a);
    expect(await wb.pageFor("a")).toBe(a);
    const b = await wb.pageFor("b");
    expect(b).not.toBe(a);
    expect(wb.browserRunning()).toBe(true);
    // Browser-wide, then for each card's own context, which the browser-wide setting doesn't cover.
    const ctx = sentOf(cdp, "Target.createTarget")[0]?.params.browserContextId;
    expect(sentOf(cdp, "Browser.setDownloadBehavior").map((s) => s.params)).toEqual([{ behavior: "deny" }, { behavior: "deny", browserContextId: ctx }, { behavior: "deny", browserContextId: ctx }]);
    expect(sentOf(cdp, "Target.createBrowserContext")).toHaveLength(2);
    expect(sentOf(cdp, "Target.createTarget")[0]?.params).toMatchObject({ url: "about:blank", width: 1280, height: 800 });
    expect(sentOf(cdp, "Fetch.enable").map((s) => s.sessionId)).toEqual([a.sessionId, b.sessionId]);
    expect(sentOf(cdp, "Fetch.enable")[0]?.params).toEqual({ patterns: [{ urlPattern: "file://*" }] });
    expect(sentOf(cdp, "Target.setAutoAttach")[0]?.params).toEqual({ autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    expect(wb.existingPage("a")).toBe(a);
    expect(wb.existingPage("nobody")).toBeNull();
  });

  it("lets a failed start be tried again", async () => {
    wb.setBrowserLauncher(() => {
      throw new Error("no Chromium");
    });
    await expect(wb.pageFor("a")).rejects.toThrow("no Chromium");
    expect(wb.browserRunning()).toBe(false);
    wb.setBrowserLauncher(newCdp);
    await expect(wb.pageFor("a")).resolves.toBeTruthy();
  });

  it("opens a fresh page when the card's was destroyed", async () => {
    const a = await wb.pageFor("a");
    cdp.emit({ method: "Target.detachedFromTarget", params: { sessionId: a.sessionId } });
    expect(wb.existingPage("a")).toBeNull();
    expect(await wb.pageFor("a")).not.toBe(a);
  });
});

describe("the guard", () => {
  it("lets an allowed file through, fails the rest, and ignores other events", async () => {
    const a = await wb.pageFor("a");
    cdp.emit({ method: "Fetch.requestPaused", params: { requestId: "r1", request: { url: "file:///show/plan.html" } }, sessionId: a.sessionId });
    cdp.emit({ method: "Fetch.requestPaused", params: { requestId: "r2", request: { url: "file:///home/secret.json" } }, sessionId: a.sessionId });
    expect(sentOf(cdp, "Fetch.continueRequest")).toEqual([{ method: "Fetch.continueRequest", params: { requestId: "r1" }, sessionId: a.sessionId }]);
    expect(sentOf(cdp, "Fetch.failRequest")).toEqual([{ method: "Fetch.failRequest", params: { requestId: "r2", errorReason: "AccessDenied" }, sessionId: a.sessionId }]);
  });

  it("guards a frame in another process before it runs, and closes a page a page opened", async () => {
    const a = await wb.pageFor("a");
    cdp.emit({ method: "Target.attachedToTarget", params: { sessionId: "child", targetInfo: { type: "iframe", targetId: "f1" } }, sessionId: a.sessionId });
    await flush();
    expect(sentOf(cdp, "Fetch.enable").at(-1)?.sessionId).toBe("child");
    expect(sentOf(cdp, "Runtime.runIfWaitingForDebugger")[0]?.sessionId).toBe("child");
    // A worker can't take auto-attach; it still runs.
    cdp.answers["Target.setAutoAttach"] = new Error("not here");
    cdp.emit({ method: "Target.attachedToTarget", params: { sessionId: "w", targetInfo: { type: "worker", targetId: "w1" } }, sessionId: a.sessionId });
    await flush();
    expect(sentOf(cdp, "Runtime.runIfWaitingForDebugger").at(-1)?.sessionId).toBe("w");
    // A frame whose guard couldn't go in stays paused rather than load unguarded.
    cdp.emit({ method: "Target.attachedToTarget", params: { sessionId: "f2", targetInfo: { type: "iframe", targetId: "f2" } }, sessionId: a.sessionId });
    await flush();
    expect(sentOf(cdp, "Runtime.runIfWaitingForDebugger").map((s) => s.sessionId)).toEqual(["child", "w"]);
    cdp.emit({ method: "Target.attachedToTarget", params: { sessionId: "p", targetInfo: { type: "page", targetId: "pop" } }, sessionId: a.sessionId });
    // Our own attach, at the browser's level, is left alone.
    cdp.emit({ method: "Target.attachedToTarget", params: { sessionId: "x", targetInfo: { type: "page", targetId: a.targetId } } });
    expect(sentOf(cdp, "Target.closeTarget").map((s) => s.params.targetId)).toEqual(["pop"]);
  });

  it("closes a popup in a card's context, not the card's page or another browser's", async () => {
    const a = await wb.pageFor("a");
    const ctx = sentOf(cdp, "Target.createTarget")[0]?.params.browserContextId;
    cdp.emit({ method: "Target.targetCreated", params: { targetInfo: { type: "page", targetId: "popup", browserContextId: ctx } } });
    cdp.emit({ method: "Target.targetCreated", params: { targetInfo: { type: "page", targetId: a.targetId, browserContextId: ctx } } });
    cdp.emit({ method: "Target.targetCreated", params: { targetInfo: { type: "page", targetId: "else", browserContextId: "other" } } });
    cdp.emit({ method: "Target.targetCreated", params: { targetInfo: { type: "service_worker", targetId: "sw", browserContextId: ctx } } });
    expect(sentOf(cdp, "Target.closeTarget").map((s) => s.params.targetId)).toEqual(["popup"]);
  });
});

describe("commands whose failure changes nothing", () => {
  it("drop their rejections: the guard's answers, a popup's close, downloads, a context's disposal", async () => {
    newCdp();
    cdp.answers["Browser.setDownloadBehavior"] = (p: { browserContextId?: string }) => (p.browserContextId ? {} : Promise.reject(new Error("gone")));
    for (const m of ["Fetch.continueRequest", "Fetch.failRequest", "Target.closeTarget", "Target.disposeBrowserContext", "Runtime.runIfWaitingForDebugger"]) cdp.answers[m] = new Error("gone");
    const made = cdp;
    wb.setBrowserLauncher(() => made);
    const a = await wb.pageFor("a");
    cdp.emit({ method: "Fetch.requestPaused", params: { requestId: "r1", request: { url: "file:///ok.html" } }, sessionId: a.sessionId });
    cdp.emit({ method: "Fetch.requestPaused", params: { requestId: "r2", request: { url: "file:///secret" } }, sessionId: a.sessionId });
    cdp.emit({ method: "Target.attachedToTarget", params: { sessionId: "p", targetInfo: { type: "page", targetId: "pop" } }, sessionId: a.sessionId });
    cdp.emit({ method: "Target.attachedToTarget", params: { sessionId: "f", targetInfo: { type: "iframe", targetId: "f1" } }, sessionId: a.sessionId });
    wb.closePage("a");
    await flush();
    expect(wb.browserRunning()).toBe(false);
    wb.setBrowserLauncher(newCdp);
  });
});

describe("idle", () => {
  it("closes a card's context after IDLE_MS unused, and the browser with the last one", async () => {
    await wb.pageFor("a");
    await wb.pageFor("b");
    vi.advanceTimersByTime(wb.IDLE_MS / 2);
    wb.touch("b");
    wb.touch("nobody");
    vi.advanceTimersByTime(wb.IDLE_MS / 2 + 1);
    await flush();
    expect(wb.existingPage("a")).toBeNull();
    expect(sentOf(cdp, "Target.disposeBrowserContext")).toHaveLength(1);
    expect(wb.browserRunning()).toBe(true);
    vi.advanceTimersByTime(wb.IDLE_MS);
    await flush();
    await flush();
    expect(wb.browserRunning()).toBe(false);
    expect(cdp.closed).toBe(true);
  });

  it("keeps a page a live view holds open", async () => {
    await wb.pageFor("a");
    let held = true;
    wb.holdOpen("a", () => held);
    wb.holdOpen("nobody", () => true);
    wb.touch("a");
    vi.advanceTimersByTime(wb.IDLE_MS + 1);
    expect(wb.existingPage("a")).not.toBeNull();
    held = false;
    vi.advanceTimersByTime(wb.IDLE_MS + 1);
    await flush();
    expect(wb.existingPage("a")).toBeNull();
  });

  it("forgets every page when the browser goes away, and closing twice is nothing", async () => {
    await wb.pageFor("a");
    cdp.close();
    expect(wb.browserRunning()).toBe(false);
    expect(wb.existingPage("a")).toBeNull();
    wb.closePage("a");
    wb.stopBrowser();
  });
});
