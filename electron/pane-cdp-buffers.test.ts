import { describe, expect, it } from "vitest";
import { emit, fakePage, paneCdp } from "./pane-cdp-fakes";
import { MAX_ENTRIES } from "./pane-cdp.cjs";

describe("createPaneCdp", () => {
  it("collects console calls in order, with a time", () => {
    const { wc, debugger: dbg } = fakePage();
    const cdp = paneCdp({ now: () => 1000 });
    cdp.attach(wc);
    emit(dbg, "Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: "one" }] });
    emit(dbg, "Runtime.consoleAPICalled", { type: "error", args: [{ type: "string", value: "two" }] });
    const entries = cdp.consoleLogs(wc, "all");
    expect(entries.map((e) => e.text)).toEqual(["one", "two"]);
    expect(entries[0]?.time).toBe(1000);
  });

  it("keeps errors and warnings by default", () => {
    const { wc, debugger: dbg } = fakePage();
    const cdp = paneCdp();
    cdp.attach(wc);
    emit(dbg, "Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: "noise" }] });
    emit(dbg, "Runtime.consoleAPICalled", { type: "warning", args: [{ type: "string", value: "careful" }] });
    emit(dbg, "Runtime.consoleAPICalled", { type: "error", args: [{ type: "string", value: "broken" }] });
    expect(cdp.consoleLogs(wc).map((e) => e.text)).toEqual(["careful", "broken"]);
  });

  it("keeps errors only when asked", () => {
    const { wc, debugger: dbg } = fakePage();
    const cdp = paneCdp();
    cdp.attach(wc);
    emit(dbg, "Runtime.consoleAPICalled", { type: "warning", args: [{ type: "string", value: "careful" }] });
    emit(dbg, "Runtime.consoleAPICalled", { type: "error", args: [{ type: "string", value: "broken" }] });
    expect(cdp.consoleLogs(wc, "error").map((e) => e.text)).toEqual(["broken"]);
  });

  it("keeps at most MAX_ENTRIES console entries", () => {
    const { wc, debugger: dbg } = fakePage();
    const cdp = paneCdp();
    cdp.attach(wc);
    for (let i = 0; i < MAX_ENTRIES + 10; i++) {
      emit(dbg, "Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: `line ${i}` }] });
    }
    const entries = cdp.consoleLogs(wc, "all");
    expect(entries).toHaveLength(MAX_ENTRIES);
    // The oldest are the ones that went.
    expect(entries[0]?.text).toBe("line 10");
    expect(entries.at(-1)?.text).toBe(`line ${MAX_ENTRIES + 9}`);
  });

  it("records a failed request with its status and method", () => {
    const { wc, debugger: dbg } = fakePage();
    const cdp = paneCdp();
    cdp.attach(wc);
    emit(dbg, "Network.requestWillBeSent", {
      requestId: "1",
      request: { url: "http://localhost:3000/api/thing", method: "POST" },
      type: "XHR",
    });
    emit(dbg, "Network.responseReceived", {
      requestId: "1",
      response: { status: 404, url: "http://localhost:3000/api/thing" },
      type: "XHR",
    });
    expect(cdp.networkErrors(wc)).toEqual([
      { status: 404, method: "POST", url: "http://localhost:3000/api/thing", type: "XHR", time: expect.any(Number) as unknown },
    ]);
  });

  it("doesn't record a request that succeeded", () => {
    const { wc, debugger: dbg } = fakePage();
    const cdp = paneCdp();
    cdp.attach(wc);
    emit(dbg, "Network.requestWillBeSent", { requestId: "1", request: { url: "http://x/", method: "GET" }, type: "Document" });
    emit(dbg, "Network.responseReceived", { requestId: "1", response: { status: 200, url: "http://x/" }, type: "Document" });
    expect(cdp.networkErrors(wc)).toEqual([]);
  });

  it("calls a response with no request a GET", () => {
    const { wc, debugger: dbg } = fakePage();
    const cdp = paneCdp();
    cdp.attach(wc);
    emit(dbg, "Network.responseReceived", { requestId: "unknown", response: { status: 500, url: "http://x/" }, type: "Fetch" });
    expect(cdp.networkErrors(wc)[0]).toMatchObject({ status: 500, method: "GET", url: "http://x/" });
  });

  it("records a request that failed to load", () => {
    const { wc, debugger: dbg } = fakePage();
    const cdp = paneCdp();
    cdp.attach(wc);
    emit(dbg, "Network.requestWillBeSent", { requestId: "1", request: { url: "http://x/img.png", method: "GET" }, type: "Image" });
    emit(dbg, "Network.loadingFailed", { requestId: "1", type: "Image", errorText: "net::ERR_FAILED" });
    expect(cdp.networkErrors(wc)).toEqual([
      { status: 0, method: "GET", url: "http://x/img.png", type: "Image", error: "net::ERR_FAILED", time: expect.any(Number) as unknown },
    ]);
  });

  it("ignores a request the page cancelled", () => {
    const { wc, debugger: dbg } = fakePage();
    const cdp = paneCdp();
    cdp.attach(wc);
    emit(dbg, "Network.requestWillBeSent", { requestId: "1", request: { url: "http://x/", method: "GET" }, type: "Fetch" });
    emit(dbg, "Network.loadingFailed", { requestId: "1", type: "Fetch", canceled: true, errorText: "net::ERR_ABORTED" });
    expect(cdp.networkErrors(wc)).toEqual([]);
  });

  it("ignores a failure for a request it never saw", () => {
    const { wc, debugger: dbg } = fakePage();
    const cdp = paneCdp();
    cdp.attach(wc);
    emit(dbg, "Network.loadingFailed", { requestId: "nope", type: "Fetch", errorText: "net::ERR_FAILED" });
    expect(cdp.networkErrors(wc)).toEqual([]);
  });

  it("forgets a request that finished", () => {
    const { wc, debugger: dbg } = fakePage();
    const cdp = paneCdp();
    cdp.attach(wc);
    emit(dbg, "Network.requestWillBeSent", { requestId: "1", request: { url: "http://x/", method: "GET" }, type: "Fetch" });
    emit(dbg, "Network.loadingFinished", { requestId: "1" });
    emit(dbg, "Network.loadingFailed", { requestId: "1", type: "Fetch", errorText: "net::ERR_FAILED" });
    expect(cdp.networkErrors(wc)).toEqual([]);
  });

  it("keeps at most MAX_ENTRIES network errors", () => {
    const { wc, debugger: dbg } = fakePage();
    const cdp = paneCdp();
    cdp.attach(wc);
    for (let i = 0; i < MAX_ENTRIES + 5; i++) {
      emit(dbg, "Network.responseReceived", { requestId: `r${i}`, response: { status: 500, url: `http://x/${i}` }, type: "Fetch" });
    }
    const errors = cdp.networkErrors(wc);
    expect(errors).toHaveLength(MAX_ENTRIES);
    expect(errors[0]?.url).toBe("http://x/5");
  });
});
