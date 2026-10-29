// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { clearOfMenu } from "./pane-clear";

// The page is a native view drawn above the board, so a menu over it cannot be painted on top:
// the page steps aside around the menu instead.
describe("clearOfMenu", () => {
  const page = { x: 800, y: 100, width: 400, height: 600 };

  it("leaves the page alone when no menu is open", () => {
    expect(clearOfMenu(page, null)).toEqual(page);
  });

  it("leaves the page alone when the menu misses it", () => {
    expect(clearOfMenu(page, { x: 100, y: 100, width: 200, height: 200 })).toEqual(page);
  });

  it("shortens the page from the top when the menu hangs off its right edge", () => {
    // The zoom menu: 224 px wide, hanging down from the toolbar on the right of the pane.
    const menu = { x: 976, y: 140, width: 224, height: 320 };
    expect(clearOfMenu(page, menu)).toEqual({ x: 800, y: 460, width: 400, height: 240 });
  });

  it("keeps the strip to the menu's right when the menu hangs off its left edge", () => {
    const menu = { x: 800, y: 140, width: 224, height: 320 };
    expect(clearOfMenu(page, menu)).toEqual({ x: 1024, y: 100, width: 176, height: 600 });
  });

  it("keeps the strip to the menu's left when the menu sits in the page's middle", () => {
    const menu = { x: 900, y: 140, width: 100, height: 320 };
    expect(clearOfMenu(page, menu)).toEqual({ x: 800, y: 100, width: 100, height: 600 });
  });

  it("hides the page when the menu covers all of it", () => {
    expect(clearOfMenu(page, { x: 790, y: 90, width: 420, height: 620 })).toBeNull();
  });

  it("keeps the strip below when the menu covers the page's whole width at the top", () => {
    expect(clearOfMenu(page, { x: 800, y: 100, width: 400, height: 200 })).toEqual({ x: 800, y: 300, width: 400, height: 400 });
  });
});
