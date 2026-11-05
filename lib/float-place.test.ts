// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { currentArea, fitWidth, paneBox, placeAbove, placeBeside, placeMenuBelow, setPaneBox, visibleArea } from "./float-place";

const WIN = { width: 1280, height: 800 };
// The pane on the right, from x=700 to the window's edge.
const PANE = { x: 700, y: 40, width: 580, height: 760 };
const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

afterEach(() => setPaneBox(null));

describe("pane box", () => {
  it("remembers the pane's bounds and forgets an empty or missing one", () => {
    expect(paneBox()).toBeNull();
    setPaneBox(PANE);
    expect(paneBox()).toEqual(PANE);
    setPaneBox({ x: 0, y: 0, width: 0, height: 0 });
    expect(paneBox()).toBeNull();
    setPaneBox(PANE);
    setPaneBox({ x: 10, y: 10, width: 100, height: 0 });
    expect(paneBox()).toBeNull();
    setPaneBox(PANE);
    setPaneBox(null);
    expect(paneBox()).toBeNull();
  });
});

describe("visibleArea", () => {
  it("is the whole window with no pane", () => {
    expect(visibleArea(WIN, null)).toEqual({ left: 0, top: 0, right: 1280, bottom: 800 });
  });

  it("stops at the pane's left edge when it sits on the right", () => {
    expect(visibleArea(WIN, PANE)).toEqual({ left: 0, top: 0, right: 700, bottom: 800 });
  });

  it("stops at the pane's top edge when it spans the width below", () => {
    expect(visibleArea(WIN, { x: 0, y: 500, width: 1280, height: 300 })).toEqual({ left: 0, top: 0, right: 1280, bottom: 500 });
  });

  it("leaves the window alone for a pane at the top-left corner", () => {
    expect(visibleArea(WIN, { x: 0, y: 0, width: 1280, height: 800 })).toEqual({ left: 0, top: 0, right: 1280, bottom: 800 });
  });

  it("reads the live window and the remembered pane", () => {
    expect(currentArea()).toEqual({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight });
    setPaneBox({ x: 300, y: 0, width: 200, height: 200 });
    expect(currentArea().right).toBe(Math.min(300, window.innerWidth));
  });
});

describe("fitWidth", () => {
  it("keeps the bubble's own limit when the area is wide", () => {
    expect(fitWidth(visibleArea(WIN, PANE), 260)).toBe(260);
  });

  it("narrows the bubble to the area, never below zero", () => {
    expect(fitWidth({ left: 0, top: 0, right: 200, bottom: 800 }, 260)).toBe(184);
    expect(fitWidth({ left: 0, top: 0, right: 10, bottom: 800 }, 260)).toBe(0);
  });
});

describe("placeAbove", () => {
  const area = visibleArea(WIN, PANE);
  const bubble = { width: 240, height: 40 };

  it("sits above the trigger, starting at its left edge", () => {
    expect(placeAbove(rect(100, 400, 60, 20), bubble, area)).toEqual({ left: 100, top: 354 });
  });

  it("drops below the trigger when there's no room above", () => {
    expect(placeAbove(rect(100, 20, 60, 20), bubble, area)).toEqual({ left: 100, top: 46 });
  });

  it("flips to end at the trigger's right edge near the pane", () => {
    // The +1211/-806 counter at the right edge of the thread panel, just left of the pane.
    expect(placeAbove(rect(600, 700, 80, 20), bubble, area)).toEqual({ left: 440, top: 654 });
  });

  it("is kept inside the visible area when even the flip runs past it", () => {
    expect(placeAbove(rect(650, 700, 60, 20), { width: 400, height: 40 }, area).left).toBe(292);
  });

  it("never starts left of the area", () => {
    expect(placeAbove(rect(2, 400, 20, 20), bubble, area).left).toBe(8);
  });

  it("is kept above the bottom of the area", () => {
    const low = { left: 0, top: 0, right: 1280, bottom: 500 };
    expect(placeAbove(rect(100, 10, 20, 480), bubble, low).top).toBe(452);
  });
});

describe("placeBeside", () => {
  const area = visibleArea(WIN, PANE);
  const preview = { width: 420, height: 300 };

  it("opens right of the trigger when it fits", () => {
    expect(placeBeside(rect(100, 200, 52, 52), preview, area)).toEqual({ left: 162, top: 160 });
  });

  it("flips to the left of the trigger when the pane is in the way", () => {
    expect(placeBeside(rect(500, 200, 52, 52), preview, area)).toEqual({ left: 70, top: 160 });
  });

  it("is clamped into the area at its edges", () => {
    expect(placeBeside(rect(300, 20, 52, 52), preview, area)).toEqual({ left: 8, top: 8 });
    expect(placeBeside(rect(100, 700, 52, 52), preview, area).top).toBe(492);
  });
});

describe("placeMenuBelow", () => {
  const area = visibleArea(WIN, PANE);

  it("opens under the trigger, ending at its right edge", () => {
    expect(placeMenuBelow(rect(500, 100, 80, 30), 340, area, 480)).toEqual({ left: 240, top: 136, maxHeight: 480 });
  });

  it("slides right to stay inside a narrow panel's window edge", () => {
    expect(placeMenuBelow(rect(240, 100, 80, 30), 340, area, 480).left).toBe(8);
  });

  it("slides left to stay clear of the pane", () => {
    expect(placeMenuBelow(rect(600, 100, 200, 30), 340, area, 480).left).toBe(352);
  });

  it("is no taller than the room below", () => {
    expect(placeMenuBelow(rect(500, 600, 80, 30), 340, area, 480).maxHeight).toBe(156);
    expect(placeMenuBelow(rect(500, 900, 80, 30), 340, area, 480).maxHeight).toBe(0);
  });
});
