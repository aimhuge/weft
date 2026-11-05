import { describe, expect, it, vi } from "vitest";
import { createPaneFind } from "./pane-find.cjs";

function page() {
  const handlers: Record<string, (e: unknown, r: unknown) => void> = {};
  return {
    isDestroyed: () => false,
    findInPage: vi.fn(),
    stopFindInPage: vi.fn(),
    focus: vi.fn(),
    on: (name: string, fn: (e: unknown, r: unknown) => void) => (handlers[name] = fn),
    found: (result: unknown) => handlers["found-in-page"]?.({}, result),
  };
}

describe("createPaneFind", () => {
  it("starts a new search, then steps within it", () => {
    const wc = page();
    const find = createPaneFind({ current: () => wc, send: vi.fn() });
    find.find("cat");
    expect(wc.findInPage).toHaveBeenLastCalledWith("cat", { forward: true, findNext: true });
    find.find("cat", { forward: false, next: true });
    expect(wc.findInPage).toHaveBeenLastCalledWith("cat", { forward: false, findNext: false });
  });

  it("does nothing with no page or no text", () => {
    const wc = page();
    createPaneFind({ current: () => undefined, send: vi.fn() }).find("cat");
    createPaneFind({ current: () => wc, send: vi.fn() }).find("");
    expect(wc.findInPage).not.toHaveBeenCalled();
  });

  it("clears the last page when find moves to another tab", () => {
    const [a, b] = [page(), page()];
    let now = a;
    const find = createPaneFind({ current: () => now, send: vi.fn() });
    find.find("cat");
    now = b;
    find.find("cat");
    expect(a.stopFindInPage).toHaveBeenCalledWith("clearSelection");
    expect(b.findInPage).toHaveBeenCalled();
  });

  it("stops, handing the keyboard back only when asked", () => {
    const wc = page();
    const find = createPaneFind({ current: () => wc, send: vi.fn() });
    find.find("cat");
    find.stop();
    expect(wc.stopFindInPage).toHaveBeenCalledTimes(1);
    expect(wc.focus).not.toHaveBeenCalled();
    find.stop();
    expect(wc.stopFindInPage).toHaveBeenCalledTimes(1);
    find.stop(true);
    expect(wc.focus).toHaveBeenCalledTimes(1);
  });

  it("leaves a destroyed page alone", () => {
    const wc = { ...page(), isDestroyed: () => true };
    const find = createPaneFind({ current: () => wc, send: vi.fn() });
    find.find("cat");
    find.stop(true);
    expect(wc.findInPage).not.toHaveBeenCalled();
  });

  it("reports the count from the page being searched only", () => {
    const [a, b] = [page(), page()];
    const send = vi.fn();
    const find = createPaneFind({ current: () => a, send });
    find.watch(a);
    find.watch(b);
    find.find("cat");
    b.found({ activeMatchOrdinal: 9, matches: 9 });
    expect(send).not.toHaveBeenCalled();
    a.found({ activeMatchOrdinal: 2, matches: 5 });
    a.found({});
    expect(send.mock.calls).toEqual([[{ active: 2, matches: 5 }], [{ active: 0, matches: 0 }]]);
  });
});
