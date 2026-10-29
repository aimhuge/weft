import { describe, expect, it } from "vitest";
import { parseSelector, isTextual, invalidMessage } from "./pane-selector.cjs";

// The selector an agent writes: a CSS selector, sometimes with Playwright's text pseudo-classes.
// The browser's querySelector throws on those ("not a valid selector"), so the page finds the element
// itself by reading text (electron/pane-selector.cjs).

describe("parseSelector", () => {
  it("leaves a plain CSS selector alone", () => {
    expect(parseSelector('button[role="menuitem"]')).toEqual({ css: 'button[role="menuitem"]', conditions: [] });
  });

  it("pulls out :text-is() and keeps the CSS part", () => {
    expect(parseSelector('[role="menu"] button[role="menuitem"]:has(span:text-is("Settings…"))')).toEqual({
      css: '[role="menu"] button[role="menuitem"]',
      conditions: [{ scope: "descendant", css: "span", exact: true, value: "Settings…" }],
    });
  });

  it("reads :text-is(), :text(), :has-text() and :text-matches()", () => {
    expect(parseSelector('a:text-is("Save")').conditions).toEqual([{ scope: "self", exact: true, value: "Save" }]);
    expect(parseSelector('a:text("Save")').conditions).toEqual([{ scope: "self", exact: true, value: "Save" }]);
    expect(parseSelector('a:has-text("Save")').conditions).toEqual([{ scope: "self", contains: true, value: "Save" }]);
    expect(parseSelector('a:text-matches("^Save")').conditions).toEqual([{ scope: "self", matches: true, value: "^Save" }]);
  });

  it("takes the text out of quotes", () => {
    expect(parseSelector("a:text-is('Settings…')").conditions).toEqual([{ scope: "self", exact: true, value: "Settings…" }]);
    expect(parseSelector('a:text-is("a\\"b")').conditions).toEqual([{ scope: "self", exact: true, value: 'a"b' }]);
  });

  it("keeps an unknown pseudo-class for CSS to complain about", () => {
    expect(parseSelector("a:visible")).toEqual({ css: "a:visible", conditions: [] });
  });

  it("collects several text tests", () => {
    expect(parseSelector('div:has-text("menu"):text-is("Settings…")').conditions).toEqual([
      { scope: "self", contains: true, value: "menu" },
      { scope: "self", exact: true, value: "Settings…" },
    ]);
  });
});

describe("isTextual", () => {
  it("says a selector needs the page's help", () => {
    expect(isTextual('button:text-is("Settings…")')).toBe(true);
    expect(isTextual('button[role="menuitem"]')).toBe(false);
  });
});

describe("invalidMessage", () => {
  it("says what to do instead", () => {
    expect(invalidMessage("!!!")).toContain("isn't a valid CSS selector");
    expect(invalidMessage("!!!")).toContain("take a snapshot and use the element's ref");
  });
});
