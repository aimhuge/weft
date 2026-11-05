// electron/pane-tabs.cjs: the tabs of each card's browser, without Electron.
import { describe, expect, it } from "vitest";
import { createPaneTabs } from "./pane-tabs.cjs";

describe("createPaneTabs", () => {
  it("has no current tab for a card it hasn't seen", () => {
    const tabs = createPaneTabs();
    expect(tabs.current("c1")).toBeUndefined();
    expect(tabs.list("c1")).toEqual([]);
  });

  it("makes a card's first tab current", () => {
    const tabs = createPaneTabs();
    const tab = tabs.add("c1", "a");
    expect(tabs.current("c1")).toBe(tab);
    expect(tab.view).toBe("a");
  });

  it("opens a new tab right after the current one and switches to it", () => {
    const tabs = createPaneTabs();
    const a = tabs.add("c1", "a");
    tabs.add("c1", "b");
    tabs.select("c1", a.id);
    const c = tabs.add("c1", "c");
    expect(tabs.list("c1").map((t) => t.view as string)).toEqual(["a", "c", "b"]);
    expect(tabs.current("c1")).toBe(c);
  });

  it("keeps each card's tabs apart, with ids unique across cards", () => {
    const tabs = createPaneTabs();
    const a = tabs.add("c1", "a");
    const b = tabs.add("c2", "b");
    expect(a.id).not.toBe(b.id);
    expect(tabs.select("c1", b.id)).toBe(false);
    expect(tabs.current("c1")).toBe(a);
    expect(tabs.keys()).toEqual(["c1", "c2"]);
  });

  it("selects a tab the card has", () => {
    const tabs = createPaneTabs();
    const a = tabs.add("c1", "a");
    tabs.add("c1", "b");
    expect(tabs.select("c1", a.id)).toBe(true);
    expect(tabs.current("c1")).toBe(a);
    expect(tabs.select("nope", a.id)).toBe(false);
  });

  it("never closes a card's last tab", () => {
    const tabs = createPaneTabs();
    const a = tabs.add("c1", "a");
    expect(tabs.close("c1", a.id)).toBeUndefined();
    expect(tabs.close("nope", a.id)).toBeUndefined();
    expect(tabs.current("c1")).toBe(a);
  });

  it("ignores a tab id the card doesn't have", () => {
    const tabs = createPaneTabs();
    tabs.add("c1", "a");
    tabs.add("c1", "b");
    expect(tabs.close("c1", 999)).toBeUndefined();
    expect(tabs.list("c1")).toHaveLength(2);
  });

  it("closing the current tab moves to its right-hand neighbour, else its left", () => {
    const tabs = createPaneTabs();
    const a = tabs.add("c1", "a");
    const b = tabs.add("c1", "b");
    const c = tabs.add("c1", "c");
    tabs.select("c1", b.id);
    expect(tabs.close("c1", b.id)).toBe(b);
    expect(tabs.current("c1")).toBe(c);
    tabs.close("c1", c.id);
    expect(tabs.current("c1")).toBe(a);
  });

  it("closing a background tab keeps the current one", () => {
    const tabs = createPaneTabs();
    const a = tabs.add("c1", "a");
    const b = tabs.add("c1", "b");
    tabs.close("c1", a.id);
    expect(tabs.current("c1")).toBe(b);
  });

  it("walks every tab with its card, and forgets a card", () => {
    const tabs = createPaneTabs();
    tabs.add("c1", "a");
    tabs.add("c1", "b");
    tabs.add("c2", "c");
    expect([...tabs.all()].map((t) => `${t.key}:${String(t.view)}`)).toEqual(["c1:a", "c1:b", "c2:c"]);
    expect(tabs.remove("c1").map((t) => t.view as string)).toEqual(["a", "b"]);
    expect(tabs.current("c1")).toBeUndefined();
    expect(tabs.remove("c1")).toEqual([]);
  });
});
