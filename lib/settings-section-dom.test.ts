// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { activeSection, cardOf, findHeading, flash, presentSections } from "./settings-section-dom";

// The DOM half of Settings' section nav (lib/settings-section-dom.ts).

function page(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

// Puts a heading at a given top, since jsdom lays nothing out.
function at(el: Element | null, top: number) {
  (el as HTMLElement).getBoundingClientRect = () => ({ top, bottom: top + 20 }) as DOMRect;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("findHeading", () => {
  it("finds an h3 or h4 by its exact text", () => {
    const root = page(`<h3> Sounds </h3><p>Sounds</p><h4>Phones</h4><h3>Sounds extra</h3>`);
    expect(findHeading(root, "Sounds")?.tagName).toBe("H3");
    expect(findHeading(root, "Phones")?.tagName).toBe("H4");
    expect(findHeading(root, "Copilot")).toBeNull();
  });
});

describe("presentSections", () => {
  it("lists the page's sections that are drawn, in the page's order", () => {
    const root = page(`<h3>Thread instructions</h3><h3>Threads running at once</h3>`);
    expect(presentSections(root, "threads").map((s) => s.title)).toEqual(["Threads running at once", "Thread instructions"]);
  });
});

describe("activeSection", () => {
  it("is the last heading at or above the line", () => {
    const root = page(`<h3>A</h3><h3>B</h3><h3>C</h3>`);
    const [a, b, c] = root.querySelectorAll("h3");
    at(a!, -200);
    at(b!, 100);
    at(c!, 400);
    expect(activeSection(root, ["A", "B", "C"], 100)).toBe("B");
    expect(activeSection(root, ["A", "B", "C"], 50)).toBe("A");
  });

  it("is the first while none has reached it, skips a missing one, and is none for no sections", () => {
    const root = page(`<h3>A</h3>`);
    at(root.querySelector("h3"), 300);
    expect(activeSection(root, ["A", "Gone"], 100)).toBe("A");
    expect(activeSection(root, [], 100)).toBeNull();
  });
});

describe("cardOf and flash", () => {
  it("finds the card around a heading, or the heading itself", () => {
    const root = page(`<div data-settings-card><h3>A</h3></div><h3>B</h3>`);
    const [a, b] = root.querySelectorAll("h3");
    expect(cardOf(a!)).toBe(root.querySelector("[data-settings-card]"));
    expect(cardOf(b!)).toBe(b);
  });

  it("rings the card where Web Animations exist and does nothing where they don't", () => {
    const el = document.createElement("div");
    expect(() => flash(el)).not.toThrow();
    const animate = vi.fn();
    Object.assign(el, { animate });
    flash(el);
    expect(animate).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ duration: 1400 }));
  });
});
