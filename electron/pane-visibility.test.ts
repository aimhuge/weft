// electron/browser-pane.cjs: the rule that decides whether the pane shows for the card that just
// became active. Pure, so the tests cover it without standing up the pane's webContentsView.
import { describe, expect, it } from "vitest";
import { BOARD, activeKey, needsRestore, paneVisibleFor, switchKey } from "./pane-visibility.cjs";

describe("activeKey", () => {
  it("keeps a card's id", () => {
    expect(activeKey("c1")).toBe("c1");
  });

  it("falls back to the board when no card is open", () => {
    expect(activeKey(null)).toBe(BOARD);
    expect(activeKey("")).toBe(BOARD);
    expect(activeKey(undefined)).toBe(BOARD);
  });
});

describe("paneVisibleFor", () => {
  it("shows the pane for a card, even one with no page loaded yet", () => {
    // The bug: a card whose page hadn't loaded came up with the pane hidden, so the thread
    // opened beside an empty slot. The pane shows; the board's placeholder fills it meanwhile.
    expect(paneVisibleFor("c1")).toBe(true);
  });

  it("hides the pane when the board itself is showing", () => {
    expect(paneVisibleFor(BOARD)).toBe(false);
    expect(paneVisibleFor(null)).toBe(false);
  });
});

describe("needsRestore", () => {
  it("restores a card's remembered page when it has none loaded", () => {
    expect(needsRestore("c1", false)).toBe(true);
  });

  it("leaves a card that already has a page alone", () => {
    expect(needsRestore("c1", true)).toBe(false);
  });

  it("never restores for the board", () => {
    expect(needsRestore(BOARD, false)).toBe(false);
    expect(needsRestore(null, false)).toBe(false);
  });
});

describe("switchKey", () => {
  it("switches to the card the board asks for", () => {
    expect(switchKey("c1", BOARD)).toBe("c1");
    expect(switchKey("c2", "c1")).toBe("c2");
  });

  it("stays on the current key when the board doesn't say", () => {
    // The board's own pane toggles with no key: it is the board's page either way.
    expect(switchKey(undefined, BOARD)).toBe(BOARD);
    expect(switchKey(undefined, "c1")).toBe("c1");
    expect(switchKey(null, "c1")).toBe("c1");
  });

  it("reads an empty key as the board", () => {
    expect(switchKey("", "c1")).toBe(BOARD);
  });
});
