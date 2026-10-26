import { describe, expect, it, vi } from "vitest";
import { typeText } from "./pane-actions.cjs";

// The vault's fill: the field is found the one way the agent tools find theirs, focused, and the value typed
// in as if a person had. A selector that matches nothing is a miss, not an error.

type Params = Record<string, unknown>;

function fakeCdp(handlers: Record<string, (params: Params) => unknown> = {}) {
  const send = vi.fn((_wc: unknown, method: string, params: Params) => {
    const handler = handlers[method];
    if (!handler) return Promise.resolve({ result: { value: undefined } });
    return Promise.resolve(handler(params));
  });
  return { send };
}

function make(handlers: Record<string, (params: Params) => unknown> = {}) {
  const cdp = fakeCdp(handlers);
  const wc = { insertText: vi.fn(() => Promise.resolve()) };
  return { cdp, wc };
}

describe("typeText", () => {
  it("focuses the field and types the value in", async () => {
    const { cdp, wc } = make({
      "Runtime.evaluate": () => ({ result: { objectId: "obj-1" } }),
      "Runtime.callFunctionOn": () => ({ result: { value: {} } }),
    });
    await expect(typeText(cdp, wc, "#secret", "s3cret")).resolves.toEqual({ found: true });
    expect(wc.insertText).toHaveBeenCalledWith("s3cret");
    const focus = cdp.send.mock.calls.find((c) => c[1] === "Runtime.callFunctionOn")!;
    expect(focus[2].objectId).toBe("obj-1");
    expect(focus[2].functionDeclaration).toContain("this.focus()");
  });

  it("is a miss when no element matches the selector", async () => {
    const { cdp, wc } = make({ "Runtime.evaluate": () => ({ result: {} }) });
    await expect(typeText(cdp, wc, "#nope", "s3cret")).resolves.toEqual({ found: false });
    expect(wc.insertText).not.toHaveBeenCalled();
  });
});
