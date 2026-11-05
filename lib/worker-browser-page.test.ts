import { describe, expect, it, vi } from "vitest";
import { fakeCdp } from "./worker-browser.harness";
import { browserPage } from "./worker-browser-page";

const ev = (method: string, params: Record<string, unknown> = {}, sessionId = "s1") => ({ method, params, sessionId });

describe("browserPage", () => {
  it("is a webContents the pane's CDP modules can drive: its session's commands, messages and navigations", async () => {
    const cdp = fakeCdp({ "Runtime.evaluate": { result: { value: 2 } } });
    const page = browserPage(cdp, "card", "T", "s1");
    const messages = vi.fn();
    const navigated = vi.fn();
    const seen = vi.fn();
    page.wc.debugger.on("message", messages);
    page.wc.on("did-navigate", navigated);
    page.wc.on("found-in-page", () => {});
    const off = page.on(seen);
    page.wc.debugger.attach();
    expect(page.wc.debugger.isAttached()).toBe(true);
    await page.wc.debugger.sendCommand("Runtime.evaluate", { expression: "1+1" });
    expect(cdp.sent.at(-1)).toEqual({ method: "Runtime.evaluate", params: { expression: "1+1" }, sessionId: "s1" });

    cdp.emit(ev("Page.frameStartedLoading", { frameId: "T" }));
    expect(page.wc.isLoading()).toBe(true);
    cdp.emit(ev("Page.frameNavigated", { frame: { id: "F", parentId: "T", url: "https://frame" } }));
    cdp.emit(ev("Page.frameNavigated", { frame: { id: "T", url: "https://a.test/" } }));
    cdp.emit(ev("Page.frameNavigated", { frame: { id: "T" } }));
    expect(page.wc.getURL()).toBe("https://a.test/");
    expect(navigated).toHaveBeenCalledTimes(2);
    cdp.emit(ev("Page.navigatedWithinDocument", { frameId: "T", url: "https://a.test/#b" }));
    cdp.emit(ev("Page.navigatedWithinDocument", { frameId: "F", url: "https://frame/#x" }));
    expect(page.wc.getURL()).toBe("https://a.test/#b");
    cdp.emit(ev("Page.frameStoppedLoading", { frameId: "F" }));
    expect(page.wc.isLoading()).toBe(true);
    cdp.emit(ev("Page.frameStoppedLoading", { frameId: "T" }));
    expect(page.wc.isLoading()).toBe(false);
    cdp.emit(ev("Page.frameStartedLoading", { frameId: "T" }));
    cdp.emit(ev("Page.loadEventFired"));
    expect(page.wc.isLoading()).toBe(false);
    cdp.emit(ev("Runtime.consoleAPICalled", { type: "log" }, "other"));
    expect(messages).toHaveBeenCalledWith({}, "Page.loadEventFired", {});
    expect(messages.mock.calls.every(([, method]) => method !== "Runtime.consoleAPICalled")).toBe(true);
    expect(seen).toHaveBeenCalledWith("Page.loadEventFired", {});
    off();
    cdp.emit(ev("Page.domContentEventFired"));
    expect(seen).not.toHaveBeenCalledWith("Page.domContentEventFired", {});
  });

  it("reads its URL and title fresh, and keeps what it had when the page can't say", async () => {
    const cdp = fakeCdp({ "Runtime.evaluate": { result: { value: { url: "https://a.test/", title: "A" } } } });
    const page = browserPage(cdp, "card", "T", "s1");
    await page.refresh();
    expect([page.wc.getURL(), page.wc.getTitle()]).toEqual(["https://a.test/", "A"]);
    cdp.answers["Runtime.evaluate"] = { result: { value: {} } };
    await page.refresh();
    expect([page.wc.getURL(), page.wc.getTitle()]).toEqual(["https://a.test/", ""]);
    cdp.answers["Runtime.evaluate"] = new Error("gone");
    await page.refresh();
    expect(page.wc.getURL()).toBe("https://a.test/");
  });

  it("is destroyed when its target detaches or the browser closes, and says so to the debugger's listeners", () => {
    const cdp = fakeCdp();
    const page = browserPage(cdp, "card", "T", "s1");
    const detached = vi.fn();
    page.wc.debugger.on("detach", detached);
    cdp.emit({ method: "Target.detachedFromTarget", params: { sessionId: "other" } });
    expect(page.wc.isDestroyed()).toBe(false);
    cdp.emit({ method: "Target.detachedFromTarget", params: { sessionId: "s1" } });
    expect(page.wc.isDestroyed()).toBe(true);
    expect(page.wc.debugger.isAttached()).toBe(false);
    const other = browserPage(cdp, "card2", "T2", "s2");
    cdp.close();
    expect(other.wc.isDestroyed()).toBe(true);
    expect(detached).toHaveBeenCalledTimes(2);
  });
});
