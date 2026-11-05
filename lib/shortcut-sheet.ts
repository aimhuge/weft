import { keyCaps } from "./hotkeys";
import { splitDescription, type ShortcutSection } from "./shortcut-catalog";

// The shortcut sheet: every key the "?" dialog lists, on one landscape page to print and keep by the screen. Built from
// the same shortcutSections, so a new shortcut lands on paper with no extra work. The page has no script; it prints in
// a hidden window (electron/print.cjs) or a hidden iframe on the web (lib/print-sheet.ts).

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

const STYLE = `
@page { size: landscape; margin: 0.4in; }
* { box-sizing: border-box; }
body { margin: 0; font: 11.5px/1.3 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1d1b18; }
header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #1d1b18; padding-bottom: 4px; margin-bottom: 12px; }
header b { font-size: 22px; letter-spacing: -0.01em; }
header span, footer { color: #6b6660; font-size: 10.5px; }
main { columns: 3; column-gap: 20px; }
section { break-inside: avoid; margin-bottom: 12px; }
h2 { margin: 0 0 2px; padding-bottom: 2px; border-bottom: 1px solid #d9d3c8; font-size: 10px; letter-spacing: 0.09em; text-transform: uppercase; color: #c2561a; }
p { display: flex; justify-content: space-between; gap: 8px; margin: 0; padding: 2.6px 0; }
p > span:last-child { white-space: nowrap; }
kbd { display: inline-block; min-width: 16px; margin-left: 2px; padding: 0 3px; border: 1px solid #c9c2b6; border-bottom-width: 2px; border-radius: 3px; text-align: center; font: 10px/1.45 ui-monospace, Menlo, monospace; }
em { font-style: normal; color: #9a948b; margin: 0 1px 0 3px; }
footer { display: flex; justify-content: space-between; border-top: 1px solid #d9d3c8; padding-top: 3px; margin-top: 4px; }
`;

const caps = (spec: string, mac: boolean) => keyCaps(spec, mac).map((cap) => `<kbd>${escape(cap)}</kbd>`).join("");

// One row: what the key does (without the dialog's fine print, so the page stays one page) and its keys.
function row(description: string, keys: string[], mac: boolean) {
  return `<p><span>${escape(splitDescription(description).main)}</span><span>${keys.map((k) => caps(k, mac)).join("<em>or</em>")}</span></p>`;
}

export function shortcutSheetHtml(sections: ShortcutSection[], mac: boolean): string {
  const body = sections
    .map(({ group, items }) => `<section><h2>${escape(group)}</h2>${items.map((s) => row(s.description, s.keys, mac)).join("")}</section>`)
    .join("");
  const hold = mac ? "⌘ or ⇧" : "Ctrl or Shift";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Weft keyboard shortcuts</title><style>${STYLE}</style></head><body>
<header><b>Weft · keyboard shortcuts</b><span>Press ? in Weft to search them all</span></header>
<main>${body}</main>
<footer><span>Hold ${hold} on the board to see the keys that use it · plain keys pause while you type</span><span>weft.zip</span></footer>
</body></html>`;
}
