import { describe, expect, it } from "vitest";
import { emit, fakePage, paneCdp } from "./pane-cdp-fakes";

describe("createPaneCdp", () => {
  it("attaches to a page and turns the protocol on", () => {
    const { wc, debugger: dbg } = fakePage();
    const cdp = paneCdp();
    cdp.attach(wc);
    expect(dbg.attach).toHaveBeenCalledWith("1.3");
    const methods = dbg.sendCommand.mock.calls.map((c) => c[0]);
    expect(methods).toEqual(["Runtime.enable", "Log.enable", "Network.enable"]);
  });

  it("doesn't attach again when it's already attached", () => {
    const { wc, debugger: dbg } = fakePage({ attached: true });
    const cdp = paneCdp();
    cdp.attach(wc);
    expect(dbg.attach).not.toHaveBeenCalled();
    // The enables still go out, once.
    expect(dbg.sendCommand).toHaveBeenCalledTimes(3);
  });

  it("registers one listener, however often it's attached", () => {
    const { wc, debugger: dbg } = fakePage();
    const cdp = paneCdp();
    cdp.attach(wc);
    cdp.attach(wc);
    cdp.attach(wc);
    expect(dbg.listenerCount("message")).toBe(1);
    expect(dbg.listenerCount("detach")).toBe(1);
    expect(wc.listenerCount("did-navigate")).toBe(1);
  });

  it("says DevTools are open when something else holds the debugger", () => {
    const { wc, debugger: dbg } = fakePage();
    dbg.attach.mockImplementation(() => {
      throw new Error("Another debugger is already attached");
    });
    const cdp = paneCdp();
    expect(() => cdp.attach(wc)).toThrow("Another debugger is already attached");
    expect(() => cdp.consoleLogs(wc)).toThrow("The pane page's DevTools are open, so I can't drive it; close DevTools and try again.");
  });

  it("doesn't attach to a destroyed page", () => {
    const { wc, debugger: dbg } = fakePage({ destroyed: true });
    const cdp = paneCdp();
    cdp.attach(wc);
    expect(dbg.attach).not.toHaveBeenCalled();
  });

  it("attaches again after DevTools detached the debugger", () => {
    const { wc, debugger: dbg, detachDebugger } = fakePage();
    const cdp = paneCdp();
    cdp.attach(wc);
    expect(dbg.attach).toHaveBeenCalledTimes(1);
    detachDebugger();
    cdp.attach(wc);
    expect(dbg.attach).toHaveBeenCalledTimes(2);
    // The enables go out again, so the new session sees the page's messages.
    expect(dbg.sendCommand).toHaveBeenCalledTimes(6);
  });

  it("sends a command through the debugger", async () => {
    const { wc, debugger: dbg } = fakePage();
    dbg.sendCommand.mockResolvedValue({ result: { value: 42 } });
    const cdp = paneCdp();
    await expect(cdp.send(wc, "Runtime.evaluate", { expression: "1" })).resolves.toEqual({ result: { value: 42 } });
    expect(dbg.sendCommand).toHaveBeenCalledWith("Runtime.evaluate", { expression: "1" });
  });

  it("starts clean when the page navigates", () => {
    const { wc, debugger: dbg } = fakePage();
    const cdp = paneCdp();
    cdp.attach(wc);
    emit(dbg, "Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: "old" }] });
    emit(dbg, "Network.responseReceived", { requestId: "1", response: { status: 500, url: "http://x/" }, type: "Fetch" });
    wc.emit("did-navigate");
    expect(cdp.consoleLogs(wc, "all")).toEqual([]);
    expect(cdp.networkErrors(wc)).toEqual([]);
  });

  it("gives each page its own buffers", () => {
    const a = fakePage();
    const b = fakePage();
    const cdp = paneCdp();
    cdp.attach(a.wc);
    cdp.attach(b.wc);
    emit(a.debugger, "Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: "a" }] });
    expect(cdp.consoleLogs(a.wc, "all").map((e) => e.text)).toEqual(["a"]);
    expect(cdp.consoleLogs(b.wc, "all")).toEqual([]);
  });

  it("ignores a message it doesn't know", () => {
    const { wc, debugger: dbg } = fakePage();
    const cdp = paneCdp();
    cdp.attach(wc);
    emit(dbg, "Something.else", { whatever: true });
    emit(dbg, "Network.loadingFinished", { requestId: "unknown" });
    expect(cdp.consoleLogs(wc, "all")).toEqual([]);
    expect(cdp.networkErrors(wc)).toEqual([]);
  });

  it("keeps going when the browser refuses an enable", async () => {
    const { wc, debugger: dbg } = fakePage();
    dbg.sendCommand.mockRejectedValueOnce(new Error("not attached yet"));
    const cdp = paneCdp();
    expect(() => cdp.attach(wc)).not.toThrow();
    await Promise.resolve();
    expect(dbg.sendCommand).toHaveBeenCalledTimes(3);
  });
});
