// @vitest-environment jsdom
// The web board's workspace grid: the board has to take the whole window.
//
// The shell renders <div class="wz-app wz-workspace"> — both classes on the SAME element — with the sidebar's
// <main> as its only grid child (WorkspaceHeader returns null on the board). The shell's own rule puts that child
// in a 252px first column with the rest of the width left empty, so the board drew as a narrow strip beside a
// void. The fix widens the grid, and it only works if the rule's selector matches the markup.
//
// A descendant combinator (.wz-app .wz-workspace) asks for a .wz-workspace INSIDE a .wz-app and never matches
// the real markup, which is how the board stayed narrow for so long. This test pins the selector's shape so the
// bug can't come back as a "cleanup" of the selector.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The rules, without the comments: a comment may well name the selector it warns about.
const css = fs
  .readFileSync(path.join(__dirname, "web-board.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

// The rule that gives the board the whole row.
function gridRule(): string {
  const rule = css.match(/([^{}]+:has\(\.wz-desk\)[^{}]*)\{([^{}]*grid-template-columns[^{}]*)\}/);
  const selector = rule?.[1];
  if (!selector) throw new Error("no grid rule for the board in web-board.css");
  return selector.trim();
}

describe("the web board's workspace grid", () => {
  it("matches the workspace element the shell actually renders", () => {
    const selector = gridRule();
    // The layout puts .wz-app and .wz-workspace on one element (app/[orgSlug]/layout.tsx).
    expect(selector).toContain(".wz-app.wz-workspace");
    // A descendant combinator between them can never match that markup.
    expect(selector).not.toMatch(/\.wz-app\s+\.wz-workspace/);
  });

  it("gives the board one full-width column", () => {
    const rules = css.match(/([^{}]+:has\(\.wz-desk\)[^{}]*)\{([^{}]*)\}/g) ?? [];
    const grid = rules.find((r) => r.includes("grid-template-columns"));
    if (!grid) throw new Error("no grid rule for the board in web-board.css");
    // One column, and it takes the whole row: no fixed 252px track beside an empty 1fr.
    expect(grid).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(grid).not.toMatch(/252px/);
  });

  it("matches the shell's real markup, so the rule fires", () => {
    // The shell's own markup, as app/[orgSlug]/layout.tsx renders it: both classes on one element, and the
    // sidebar's <main> as the only grid child (WorkspaceHeader returns null on the board).
    document.body.innerHTML =
      '<div class="wz-app wz-workspace"><main class="wz-workspaceMain"><div class="wz-desk"></div></main></div>';
    const workspace = document.querySelector(".wz-workspace")!;
    // jsdom applies :has() when matching, so this is the same question the browser answers.
    expect(workspace.matches(gridRule())).toBe(true);
  });

  it("leaves the other workspace pages their sidebar", () => {
    // Without a .wz-desk (the Team and Billing pages), the shell's own two-column grid stands.
    document.body.innerHTML =
      '<div class="wz-app wz-workspace"><aside class="wz-workspaceHeader"></aside><main class="wz-workspaceMain"></main></div>';
    const workspace = document.querySelector(".wz-workspace")!;
    expect(workspace.matches(gridRule())).toBe(false);
  });
});
