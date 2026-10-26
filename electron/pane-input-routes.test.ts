import { describe, expect, it, vi } from "vitest";
import { fakePage } from "./pane-input-fakes";
import { agentRoutes } from "./pane-input.cjs";

describe("agentRoutes", () => {
  function routes(over: { input?: Record<string, unknown>; cdp?: Record<string, unknown> } = {}) {
    const input = over.input ?? {
      click: vi.fn(() => Promise.resolve({ clicked: "e1" })),
      hover: vi.fn(() => Promise.resolve({ hovered: "e1" })),
      type: vi.fn(() => Promise.resolve({ typed: "e1" })),
      press: vi.fn(() => Promise.resolve({ pressed: "Enter" })),
      select: vi.fn(() => Promise.resolve({ picked: ["Apple"] })),
      scroll: vi.fn(() => Promise.resolve({ scrolled: "e1" })),
      waitFor: vi.fn(() => Promise.resolve({ waitedMs: 1 })),
      viewport: vi.fn(() => Promise.resolve({ width: 390, height: 844 })),
      snapshot: vi.fn(() => Promise.resolve({ text: "- button", dropped: 0 })),
    };
    const cdp = over.cdp ?? {
      consoleLogs: vi.fn(() => [{ level: "error", text: "boom", at: "app.js:1" }]),
      networkErrors: vi.fn(() => [{ status: 500, method: "GET", url: "http://x/api" }]),
      send: vi.fn(() => Promise.resolve({})),
    };
    const wc = fakePage();
    const built = agentRoutes({
      input,
      cdp,
      page: () => ({ wc, key: "card-1" }),
      redact: (_key: string, text: string) => text.replace(/sk-live/g, "‹SECRET›"),
    });
    return { routes: built, input, cdp, wc };
  }

  it("has a route for every operation", () => {
    expect(Object.keys(routes().routes)).toEqual([
      "POST /browser/click",
      "POST /browser/hover",
      "POST /browser/type",
      "POST /browser/press",
      "POST /browser/select",
      "POST /browser/scroll",
      "POST /browser/wait",
      "POST /browser/viewport",
      "POST /browser/snapshot",
      "POST /browser/console",
      "POST /browser/network",
    ]);
  });

  it("passes the body's target to each operation", async () => {
    const { routes: r, input } = routes();
    await r["POST /browser/click"]({ ref: "e1", double: true });
    expect(input.click).toHaveBeenCalledWith(expect.anything(), { ref: "e1", selector: undefined }, { double: true });
    await r["POST /browser/hover"]({ selector: "#go" });
    expect(input.hover).toHaveBeenCalledWith(expect.anything(), { ref: undefined, selector: "#go" });
    await r["POST /browser/type"]({ ref: "e1", text: "hi", submit: true });
    expect(input.type).toHaveBeenCalledWith(expect.anything(), { ref: "e1", selector: undefined }, "hi", { submit: true });
    await r["POST /browser/press"]({ keys: "Enter", ref: "e1" });
    expect(input.press).toHaveBeenCalledWith(expect.anything(), "Enter", { ref: "e1", selector: undefined });
    await r["POST /browser/select"]({ ref: "e1", values: ["Apple"] });
    expect(input.select).toHaveBeenCalledWith(expect.anything(), { ref: "e1", selector: undefined }, ["Apple"]);
    await r["POST /browser/scroll"]({ ref: "e1", direction: "down" });
    expect(input.scroll).toHaveBeenCalledWith(expect.anything(), { ref: "e1", direction: "down" });
    await r["POST /browser/wait"]({ text: "Done" });
    expect(input.waitFor).toHaveBeenCalledWith(expect.anything(), { text: "Done" });
    await r["POST /browser/viewport"]({ size: "phone" });
    expect(input.viewport).toHaveBeenCalledWith(expect.anything(), { size: "phone" });
  });

  it("doesn't double a click when double isn't asked for", async () => {
    const { routes: r, input } = routes();
    await r["POST /browser/click"]({ ref: "e1" });
    expect(input.click).toHaveBeenCalledWith(expect.anything(), expect.anything(), { double: false });
  });

  it("gives the snapshot with the page's url and title", async () => {
    const { routes: r } = routes();
    await expect(r["POST /browser/snapshot"]({})).resolves.toEqual({
      url: "http://localhost:3000/",
      title: "Test page",
      text: "- button",
      dropped: 0,
    });
  });

  it("redacts the snapshot's title and text", async () => {
    const { routes: r } = routes({
      input: { snapshot: vi.fn(() => Promise.resolve({ text: "- textbox sk-live-123", dropped: 0 })) },
    });
    const page = fakePage({ title: "sk-live-123" });
    const built = agentRoutes({
      input: { snapshot: vi.fn(() => Promise.resolve({ text: "- textbox sk-live-123", dropped: 0 })) },
      cdp: { send: vi.fn(() => Promise.resolve({})), consoleLogs: vi.fn(() => []), networkErrors: vi.fn(() => []) },
      page: () => ({ wc: page, key: "card-1" }),
      redact: (_key: string, text: string) => text.replace(/sk-live/g, "‹SECRET›"),
    });
    const result = (await built["POST /browser/snapshot"]({})) as Record<string, string>;
    expect(result.title).toBe("‹SECRET›-123");
    expect(result.text).toBe("- textbox ‹SECRET›-123");
    expect(r).toBeDefined();
  });

  it("gives the console entries, with their text redacted", async () => {
    const { routes: r, cdp } = routes({
      cdp: {
        consoleLogs: vi.fn(() => [{ level: "error", text: "sk-live-123", at: "app.js:1" }]),
        networkErrors: vi.fn(() => []),
        send: vi.fn(() => Promise.resolve({})),
      },
    });
    await expect(r["POST /browser/console"]({ level: "error" })).resolves.toEqual({
      entries: [{ level: "error", text: "‹SECRET›-123", at: "app.js:1" }],
    });
    expect(cdp.consoleLogs).toHaveBeenCalledWith(expect.anything(), "error");
  });

  it("gives the network errors, with their url redacted", async () => {
    const { routes: r } = routes({
      cdp: {
        consoleLogs: vi.fn(() => []),
        networkErrors: vi.fn(() => [{ status: 500, method: "GET", url: "http://x/sk-live-123" }]),
        send: vi.fn(() => Promise.resolve({})),
      },
    });
    await expect(r["POST /browser/network"]({})).resolves.toEqual({
      entries: [{ status: 500, method: "GET", url: "http://x/‹SECRET›-123" }],
    });
  });

  it("lets go of the page's objects after every route", async () => {
    const { routes: r, cdp } = routes();
    await r["POST /browser/click"]({ ref: "e1" });
    expect(cdp.send).toHaveBeenCalledWith(expect.anything(), "Runtime.releaseObjectGroup", { objectGroup: "weft-agent" });
  });

  it("lets them go even when the route fails", async () => {
    const { routes: r, cdp } = routes({
      input: {
        click: vi.fn(() => Promise.reject(new Error("boom"))),
      },
    });
    await expect(r["POST /browser/click"]({ ref: "e1" })).rejects.toThrow("boom");
    expect(cdp.send).toHaveBeenCalledWith(expect.anything(), "Runtime.releaseObjectGroup", { objectGroup: "weft-agent" });
  });
});
