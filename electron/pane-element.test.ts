import { describe, expect, it, vi } from "vitest";
import { resolveElement } from "./pane-element.cjs";

// The one way a pane page's element is found: a ref from the snapshot, or a CSS selector. The agent tools
// (electron/pane-input.cjs) and the vault's fill (electron/pane-actions.cjs) both go through here.

type Params = Record<string, unknown>;

// A CDP session that answers per method; the default is an empty result, so a test says what it cares about.
function fakeCdp(handlers: Record<string, (params: Params) => unknown> = {}) {
  const send = vi.fn((_wc: unknown, method: string, params: Params) => {
    const handler = handlers[method];
    if (!handler) return Promise.resolve({ result: { value: undefined } });
    return Promise.resolve(handler(params));
  });
  return { send };
}

const wc = { getURL: () => "http://localhost:3000/" };

describe("resolveElement", () => {
  it("resolves a ref to an element", async () => {
    const cdp = fakeCdp({ "DOM.resolveNode": () => ({ object: { objectId: "obj-1" } }) });
    await expect(resolveElement(cdp, wc, { ref: "e12" })).resolves.toEqual({ objectId: "obj-1", label: "e12" });
    expect(cdp.send).toHaveBeenCalledWith(wc, "DOM.resolveNode", { backendNodeId: 12, objectGroup: "weft-agent" });
  });

  it("says a ref that isn't one is wrong", async () => {
    const cdp = fakeCdp({});
    await expect(resolveElement(cdp, wc, { ref: "12" })).rejects.toThrow("12 isn't a ref; refs look like e123 and come from snapshot.");
  });

  it("says a ref that's gone is gone", async () => {
    const cdp = fakeCdp({
      "DOM.resolveNode": () => {
        throw new Error("Could not find node");
      },
    });
    await expect(resolveElement(cdp, wc, { ref: "e12" })).rejects.toThrow("e12 isn't on the page any more; take a new snapshot.");
  });

  it("resolves a selector to an element", async () => {
    const cdp = fakeCdp({ "Runtime.evaluate": () => ({ result: { objectId: "obj-2" } }) });
    await expect(resolveElement(cdp, wc, { selector: "#go" })).resolves.toEqual({ objectId: "obj-2", label: "#go" });
    const evaluate = cdp.send.mock.calls.find((c) => c[1] === "Runtime.evaluate")!;
    expect(evaluate[2].expression).toBe('document.querySelector("#go")');
  });

  it("is null when no element matches the selector", async () => {
    const cdp = fakeCdp({ "Runtime.evaluate": () => ({ result: {} }) });
    await expect(resolveElement(cdp, wc, { selector: "#nope" })).resolves.toBeNull();
  });

  it("wants a ref or a selector", async () => {
    const cdp = fakeCdp({});
    await expect(resolveElement(cdp, wc, {})).rejects.toThrow("Give a ref from snapshot, or a CSS selector.");
    await expect(resolveElement(cdp, wc, { selector: "   " })).rejects.toThrow("Give a ref from snapshot, or a CSS selector.");
  });

  it("says a selector that isn't one is wrong", async () => {
    const cdp = fakeCdp({ "Runtime.evaluate": () => ({ exceptionDetails: { text: "SyntaxError" } }) });
    await expect(resolveElement(cdp, wc, { selector: "!!!" })).rejects.toThrow("!!! isn't a valid CSS selector.");
  });
});
