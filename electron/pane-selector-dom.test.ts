// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { findExpression, visibleExpression } from "./pane-selector.cjs";

// The page-side expressions, run against a real DOM: the selector an agent writes has to find the
// element it names (electron/pane-selector.cjs).

// The expression is a string the page evaluates; run it here the same way (electron/board-view.test.ts
// evaluates its page scripts this way).
function run(expression: string): unknown {
  return (0, eval)(expression) as unknown;
}

const MENU = `
  <div role="menu">
    <button role="menuitem" id="one"><span>Open…</span></button>
    <button role="menuitem" id="two"><span>Settings…</span></button>
    <button role="menuitem" id="three"><span>Quit</span></button>
  </div>
`;

describe("findExpression", () => {
  it("finds a plain CSS selector", () => {
    document.body.innerHTML = MENU;
    const el = run(findExpression("#two")) as HTMLElement;
    expect(el.id).toBe("two");
  });

  it("finds an element by its exact text", () => {
    document.body.innerHTML = MENU;
    const el = run(findExpression('button:text-is("Settings…")')) as HTMLElement;
    expect(el.id).toBe("two");
  });

  it("finds an element whose text is inside a child, the way Playwright's :has() is written", () => {
    document.body.innerHTML = MENU;
    const el = run(findExpression('[role="menu"] button[role="menuitem"]:has(span:text-is("Settings…"))')) as HTMLElement;
    expect(el.id).toBe("two");
  });

  it("finds an element by text it contains", () => {
    document.body.innerHTML = MENU;
    const el = run(findExpression('button:has-text("Qu")')) as HTMLElement;
    expect(el.id).toBe("three");
  });

  it("finds an element by a text pattern", () => {
    document.body.innerHTML = MENU;
    const el = run(findExpression('button:text-matches("^Set")')) as HTMLElement;
    expect(el.id).toBe("two");
  });

  it("is null when nothing matches", () => {
    document.body.innerHTML = MENU;
    expect(run(findExpression('button:text-is("Nope")'))).toBeNull();
  });

  it("is null when the text is close but not exact", () => {
    document.body.innerHTML = MENU;
    expect(run(findExpression('button:text-is("Settings")'))).toBeNull();
  });

  it("does not match a descendant's text on the parent alone", () => {
    document.body.innerHTML = MENU;
    // The button's own text is "Settings…", and the span's too — but the div has neither.
    expect(run(findExpression('[role="menu"]:text-is("Settings…")'))).toBeNull();
  });

  it("throws on a selector CSS can't parse", () => {
    document.body.innerHTML = MENU;
    expect(() => run(findExpression("!!!"))).toThrow();
  });
});

describe("visibleExpression", () => {
  // jsdom has no layout, so every element has a zero-size rect; give the ones we want a size.
  function sized(html: string) {
    document.body.innerHTML = html;
    for (const el of document.querySelectorAll("button, div")) {
      if (el.getAttribute("style")?.includes("display:none")) continue;
      el.getBoundingClientRect = () => ({ width: 80, height: 20, top: 0, left: 0, right: 80, bottom: 20, x: 0, y: 0 }) as DOMRect;
    }
  }

  it("says a matched element is there", () => {
    sized(MENU);
    expect(run(visibleExpression('button:text-is("Settings…")'))).toBe(true);
  });

  it("says an element that isn't there isn't", () => {
    sized(MENU);
    expect(run(visibleExpression('button:text-is("Nope")'))).toBe(false);
  });

  it("says a hidden element isn't visible", () => {
    document.body.innerHTML = `<button id="gone" style="display:none">Settings…</button>`;
    expect(run(visibleExpression('button:text-is("Settings…")'))).toBe(false);
  });
});
