import { describe, expect, it } from "vitest";
import { shortcutSheetHtml } from "./shortcut-sheet";
import type { ShortcutSection } from "./shortcut-catalog";

const sections: ShortcutSection[] = [
  { group: "General", items: [{ id: "palette", keys: ["mod+k"], description: "Command palette: search cards and run commands", group: "General" }] },
  { group: "Board", items: [{ id: "next", keys: ["j", "ArrowDown"], description: "Next card <in> the column (fine print)", group: "Board" }] },
];

describe("shortcutSheetHtml", () => {
  it("prints each section and row without the dialog's fine print", () => {
    const html = shortcutSheetHtml(sections, true);
    expect(html).toContain("<h2>General</h2>");
    expect(html).toContain("<span>Command palette</span>");
    expect(html).not.toContain("search cards");
    expect(html).not.toContain("fine print");
  });
  it("escapes descriptions and joins alternative keys with 'or'", () => {
    const html = shortcutSheetHtml(sections, true);
    expect(html).toContain("Next card &lt;in&gt; the column");
    expect(html).toContain("<kbd>J</kbd><em>or</em><kbd>↓</kbd>");
  });
  it("draws Mac or PC key caps and names the hold keys to match", () => {
    expect(shortcutSheetHtml(sections, true)).toContain("<kbd>⌘</kbd><kbd>K</kbd>");
    expect(shortcutSheetHtml(sections, true)).toContain("Hold ⌘ or ⇧");
    expect(shortcutSheetHtml(sections, false)).toContain("<kbd>Ctrl</kbd><kbd>K</kbd>");
    expect(shortcutSheetHtml(sections, false)).toContain("Hold Ctrl or Shift");
  });
  it("is one landscape page with no script", () => {
    const html = shortcutSheetHtml(sections, true);
    expect(html).toContain("@page { size: landscape");
    expect(html).not.toContain("<script");
  });
});
