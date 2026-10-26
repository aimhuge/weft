import { describe, expect, it } from "vitest";
import { placeDropdown } from "./dropdown-place";

const AREA = { left: 0, top: 0, right: 1000, bottom: 800 };
// A field near the top of the window.
const TOP_FIELD = { left: 100, top: 100, right: 320, bottom: 130, width: 220 };
// A field near the bottom, with only 40px of room below it.
const BOTTOM_FIELD = { left: 100, top: 730, right: 320, bottom: 760, width: 220 };

describe("placing a dropdown's list", () => {
  it("opens below the field when there is room", () => {
    const placement = placeDropdown(TOP_FIELD, AREA, { width: 220, height: 300 });
    expect(placement.side).toBe("below");
    expect(placement.spot.top).toBeGreaterThan(TOP_FIELD.bottom);
  });

  it("opens above the field when there is no room below", () => {
    const placement = placeDropdown(BOTTOM_FIELD, AREA, { width: 220, height: 300 });
    expect(placement.side).toBe("above");
    expect(placement.spot.top).toBeLessThan(BOTTOM_FIELD.top);
  });

  it("never runs past the bottom of the area", () => {
    const placement = placeDropdown(BOTTOM_FIELD, AREA, { width: 220, height: 300 });
    expect(placement.spot.top + placement.maxHeight).toBeLessThanOrEqual(AREA.bottom);
  });

  it("never runs past the top of the area", () => {
    const placement = placeDropdown(BOTTOM_FIELD, AREA, { width: 220, height: 2000 });
    expect(placement.spot.top).toBeGreaterThanOrEqual(AREA.top);
  });

  it("caps its height to the room it has, so the list scrolls instead of overflowing", () => {
    // A field with too little room below to hold the list: the list opens above it instead.
    const tight = { left: 100, top: 600, right: 320, bottom: 630, width: 220 };
    const placement = placeDropdown(tight, AREA, { width: 220, height: 2000 });
    expect(placement.side).toBe("above");
    expect(placement.maxHeight).toBeLessThan(2000);
    expect(placement.maxHeight).toBeGreaterThan(0);
  });

  it("stays inside the area on the right", () => {
    const field = { left: 960, top: 100, right: 990, bottom: 130, width: 30 };
    const placement = placeDropdown(field, AREA, { width: 300, height: 300 });
    expect(placement.spot.left + placement.width).toBeLessThanOrEqual(AREA.right);
  });

  it("stays inside the area on the left", () => {
    const field = { left: -50, top: 100, right: -20, bottom: 130, width: 30 };
    const placement = placeDropdown(field, AREA, { width: 300, height: 300 });
    expect(placement.spot.left).toBeGreaterThanOrEqual(AREA.left);
  });

  it("is as wide as the field, so the list lines up with the box that was clicked", () => {
    const placement = placeDropdown(TOP_FIELD, AREA, { width: TOP_FIELD.width, height: 300 });
    expect(placement.width).toBe(TOP_FIELD.width);
  });

  it("never grows wider than the area allows", () => {
    const narrow = { left: 0, top: 0, right: 200, bottom: 800 };
    const placement = placeDropdown(TOP_FIELD, narrow, { width: 600, height: 300 });
    expect(placement.width).toBeLessThanOrEqual(narrow.right - narrow.left);
  });

  it("keeps out of the browser pane's way", () => {
    // The pane sits on the right, so the area stops at x=600.
    const beside = { left: 0, top: 0, right: 600, bottom: 800 };
    const placement = placeDropdown(TOP_FIELD, beside, { width: 300, height: 300 });
    expect(placement.spot.left + placement.width).toBeLessThanOrEqual(600);
  });
});
