// electron/pane-zoom.cjs: the pane page's zoom steps.
import { describe, expect, it, vi } from "vitest";
import { stepZoom, zoomContents } from "./pane-zoom.cjs";

function page(factor = 1, destroyed = false) {
  return { getZoomFactor: () => factor, setZoomFactor: vi.fn(), isDestroyed: () => destroyed };
}

describe("stepZoom", () => {
  it("walks Chrome's steps from between them, and stops at the ends", () => {
    expect(stepZoom(100, 1)).toBe(110);
    expect(stepZoom(104, -1)).toBe(100);
    expect(stepZoom(500, 1)).toBe(500);
    expect(stepZoom(25, -1)).toBe(25);
  });
});

describe("zoomContents", () => {
  it("steps in and out, resets, and takes a clamped percentage", () => {
    const wc = page();
    expect(zoomContents(wc, "in")).toBe(true);
    expect(wc.setZoomFactor).toHaveBeenLastCalledWith(1.1);
    zoomContents(wc, "out");
    expect(wc.setZoomFactor).toHaveBeenLastCalledWith(0.9);
    zoomContents(wc, "reset");
    expect(wc.setZoomFactor).toHaveBeenLastCalledWith(1);
    zoomContents(wc, 900);
    expect(wc.setZoomFactor).toHaveBeenLastCalledWith(5);
  });

  it("does nothing for no page, a closed page or a nonsense action", () => {
    expect(zoomContents(undefined, "in")).toBe(false);
    expect(zoomContents(page(1, true), "in")).toBe(false);
    expect(zoomContents(page(), "sideways")).toBe(false);
  });
});
