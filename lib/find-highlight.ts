// Paints find's matches with the CSS Custom Highlight API: ranges over the text nodes, styled by
// ::highlight() in app/globals.css. Wrapping matches in <mark> would rewrite DOM React owns (Markdown,
// memoized rows, a reply mid-stream); a range touches nothing.
const ALL = "thread-find";
const NOW = "thread-find-now";

// A closed <details> keeps its body in the DOM, but nobody can see a match there.
function hidden(node: Node) {
  const details = node.parentElement?.closest("details:not([open])");
  return Boolean(details) && !node.parentElement?.closest("summary");
}

// Every occurrence of the query in an element, ignoring case. Text joins across nodes first, so a match
// that crosses inline formatting is still one range.
export function rangesIn(root: Element, query: string): Range[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number }[] = [];
  let text = "";
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (hidden(node)) continue;
    nodes.push({ node, start: text.length });
    text += node.data;
  }
  const lower = text.toLowerCase();
  // The node holding a match's first character, then the one holding its last.
  const startOf = (offset: number) => nodes.findLast((n) => n.start <= offset);
  const endOf = (offset: number) => nodes.findLast((n) => n.start < offset);
  const ranges: Range[] = [];
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + needle.length)) {
    const from = startOf(at);
    const to = endOf(at + needle.length);
    if (!from || !to) continue;
    const range = document.createRange();
    range.setStart(from.node, at - from.start);
    range.setEnd(to.node, at + needle.length - to.start);
    ranges.push(range);
  }
  return ranges;
}

export function clearFindHighlights() {
  if (typeof Highlight === "undefined") return;
  CSS.highlights.delete(ALL);
  CSS.highlights.delete(NOW);
}

// Paints what's drawn in the thread and returns the current match's range: the nth in its row, or the row's
// last when the row draws fewer than the data holds (markdown's source and its text differ here and there).
export function paintFindHighlights(scroller: Element, query: string, row: Element | null, nth: number): Range | null {
  const rows = [...scroller.querySelectorAll("[data-turn]")];
  const inRow = row ? rangesIn(row, query) : [];
  const current = inRow[Math.min(nth, inRow.length - 1)] ?? null;
  if (typeof Highlight !== "undefined") {
    CSS.highlights.set(ALL, new Highlight(...rows.flatMap((r) => rangesIn(r, query))));
    if (current) CSS.highlights.set(NOW, new Highlight(current));
    else CSS.highlights.delete(NOW);
  }
  return current;
}

// Brings a range to the middle of the thread. scrollIntoView reaches inside a nested scroller (a tool's
// long output); the nudge after it is for a paragraph taller than the window, where centring its element
// isn't centring the match.
export function scrollToRange(scroller: HTMLElement, range: Range) {
  range.startContainer.parentElement?.scrollIntoView({ block: "center" });
  const rect = range.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  scroller.scrollTop += rect.top - box.top - box.height / 2;
}
