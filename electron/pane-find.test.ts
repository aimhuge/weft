// electron/pane-find.cjs: find in page against a fake webContents.
import { describe, expect, it, vi } from "vitest";
import { findInPage, stopFind, watchFind } from "./pane-find.cjs";

function fakeContents(destroyed = false) {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    handlers,
    isDestroyed: () => destroyed,
    findInPage: vi.fn(),
    stopFindInPage: vi.fn(),
    on: (event: string, fn: (...args: unknown[]) => void) => handlers.set(event, fn),
  };
}

describe("findInPage", () => {
  it("starts a new search while typing and steps through it after", () => {
    const wc = fakeContents();
    findInPage(wc, "hooks");
    findInPage(wc, "hooks", { next: true });
    findInPage(wc, "hooks", { next: true, forward: false });
    expect(wc.findInPage.mock.calls).toEqual([
      ["hooks", { forward: true, findNext: true }],
      ["hooks", { forward: true, findNext: false }],
      ["hooks", { forward: false, findNext: false }],
    ]);
  });

  it("clears the highlights when the field is emptied", () => {
    const wc = fakeContents();
    findInPage(wc, "");
    findInPage(wc, undefined);
    expect(wc.findInPage).not.toHaveBeenCalled();
    expect(wc.stopFindInPage).toHaveBeenCalledWith("keepSelection");
  });

  it("does nothing without a live page", () => {
    const wc = fakeContents(true);
    findInPage(undefined, "x");
    findInPage(wc, "x");
    stopFind(undefined);
    stopFind(wc);
    expect(wc.findInPage).not.toHaveBeenCalled();
    expect(wc.stopFindInPage).not.toHaveBeenCalled();
  });
});

describe("watchFind", () => {
  it("sends the active match and the count, zero for what Chromium left out", () => {
    const wc = fakeContents();
    const onFound = vi.fn();
    watchFind(wc, onFound);
    wc.handlers.get("found-in-page")!({}, { activeMatchOrdinal: 2, matches: 7 });
    wc.handlers.get("found-in-page")!({}, {});
    expect(onFound.mock.calls).toEqual([[{ active: 2, matches: 7 }], [{ active: 0, matches: 0 }]]);
  });
});
