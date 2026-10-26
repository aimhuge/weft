// The list view's grid: the columns of the sheet. The template lives in CSS (it needs minmax(), and
// Tailwind drops an arbitrary value holding a comma), so this reads the rule and pins the two
// things that broke it before: a track that can collapse to nothing, and a sheet that overflows
// the board instead of dropping a column.
//
// A layout bug like this cannot be caught by rendering in jsdom — jsdom has no layout engine — so
// this checks the rule that produces the layout, and the widths page in ~/.weft/show/list-view
// checks the result on screen.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const css = readFileSync(path.join(__dirname, "list-grid.css"), "utf8");

// The columns of the .list-grid rule. They are declared as --sheet-cols, which @aimhuge/sheet
// reads in its own grid-template-columns: var(--sheet-cols).
function template() {
  const rule = css.match(/\.list-grid\s*\{[^}]*--sheet-cols:\s*([^;]+);/);
  expect(rule, ".list-grid must set --sheet-cols").toBeTruthy();
  return (rule?.[1] ?? "").trim();
}

// Every track in the template.
function tracks() {
  return template()
    .split(/\s+(?![^(]*\))/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// The share of a track, in fractions of the space there is.
function share(track: string) {
  return Number(track.match(/([\d.]+)fr/)?.[1] ?? 0);
}

describe("the list view's grid", () => {
  it("gives the title the largest share, since it is the column you read", () => {
    const all = tracks();
    const title = all[0] ?? "";
    const titleShare = share(title);
    expect(titleShare).toBeGreaterThan(0);
    for (const track of all.slice(1)) {
      expect(titleShare, `the title (${title}) must be wider than ${track}`).toBeGreaterThan(share(track));
    }
  });

  it("lets every wide column shrink, so no column is squeezed to nothing", () => {
    // The age and the actions stay fixed: they are small, and what they hold is always wanted.
    for (const track of tracks().filter((t) => !/^\d+px$/.test(t))) {
      expect(track, `${track} must be able to shrink to nothing`).toMatch(/^minmax\(0,/);
    }
  });

  it("keeps the sheet inside the board rather than letting it overflow", () => {
    // Fractional shares divide the space that is there, so the row is always exactly as wide as
    // its container: a fixed track beside them would overflow a narrow board.
    const fixed = tracks().filter((t) => !t.includes("fr"));
    expect(fixed.every((t) => /^\d+px$/.test(t)), "only the age and the actions may be fixed").toBe(true);
  });

  it("answers to the width of the board, not the width of the window", () => {
    // The board's width follows the rail and the thread panel, so the sheet needs a container
    // query; a media query would test the window and answer wrongly.
    expect(css).toContain("container-type: inline-size");
    expect(css).not.toMatch(/@media[^{]*\{[^}]*\.list-grid/);
  });

  it("drops the roomiest columns before it squeezes the ones that matter", () => {
    const narrow = css.match(/@container board-sheet \(max-width: 820px\)\s*\{([\s\S]*?)\n\}/);
    expect(narrow, "there must be a rule for a narrow board").toBeTruthy();
    const body = narrow![1];
    // The tags and the folder go first: the fourth and the fifth cells.
    expect(body).toMatch(/:nth-child\(4\)/);
    expect(body).toMatch(/:nth-child\(5\)/);
  });

  it("keeps the actions whole, so the buttons are never clipped", () => {
    expect(css).toMatch(/\.list-grid > \*:last-child\s*\{[^}]*overflow:\s*visible/);
  });
});
