// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { onAddressFocus, requestAddressFocus } from "./pane-new-tab";

describe("pane-new-tab", () => {
  it("hands an ask to a mounted pane, once", () => {
    const fn = vi.fn();
    const off = onAddressFocus(fn);
    expect(fn).not.toHaveBeenCalled();
    requestAddressFocus();
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    // Taken already: a pane mounting after doesn't take it again.
    const late = vi.fn();
    onAddressFocus(late)();
    expect(late).not.toHaveBeenCalled();
  });

  it("keeps an ask for a pane that mounts a moment later", () => {
    requestAddressFocus(1000);
    const fn = vi.fn();
    onAddressFocus(fn, () => 2000)();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("drops an ask nobody took in time", () => {
    requestAddressFocus(1000);
    const fn = vi.fn();
    onAddressFocus(fn, () => 5000)();
    expect(fn).not.toHaveBeenCalled();
  });

  it("stops listening once off", () => {
    const fn = vi.fn();
    onAddressFocus(fn)();
    requestAddressFocus();
    expect(fn).not.toHaveBeenCalled();
  });
});
