// The blocks of a Markdown file, for symbol claims (lib/claims.ts): MAP.md, README.md and ROADMAP.md are edited
// by nearly every card, nearly always one bullet at a time, and a whole-file claim made each of those wait on
// the others. A block is a paragraph, a table, a code fence or a top-level list item with its indented lines;
// its name is the headings above it and its opening words, `File map/lib∕runner.ts`, so two cards adding bullets
// to one section pass. Headings alone wouldn't do: MAP's File map is a single section 635 lines long.
//
// No parser, a walk over the lines: this also runs at commit (lib/commit-held.ts), which must not load TypeScript.

const MARKDOWN = /\.(md|mdx|markdown)$/i;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const ITEM = /^(?:[-*+]|\d+[.)])\s/;
const LABEL_CHARS = 40;

export function isMarkdownFile(file: string) {
  return MARKDOWN.test(file);
}

export interface MarkdownBlock {
  name: string;
  // Inclusive, 0-based lines.
  from: number;
  to: number;
}

// A line as a name: `/` is the claim path's separator and `#` the order number's, so neither may stay.
function label(line: string) {
  const words = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/[`*_[\]#|>]/g, "").replace(/\//g, "∕");
  return words.trim().slice(0, LABEL_CHARS).trim() || "block";
}

// The h2 and deeper around a line; the h1 is the file's title, so it never prefixes a name.
class Headings {
  private stack: { level: number; text: string }[] = [];

  enter(level: number, text: string) {
    this.stack = this.stack.filter((h) => h.level < level);
    if (level > 1) this.stack.push({ level, text });
  }

  path(tail?: string) {
    return [...this.stack.map((h) => h.text), ...(tail ? [tail] : [])].join("/");
  }
}

export function markdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.split("\n");
  const blocks: MarkdownBlock[] = [];
  const headings = new Headings();
  const seen = new Map<string, number>();
  const state: { open: MarkdownBlock | null } = { open: null };
  let fenced = false;
  const close = () => {
    if (state.open) blocks.push(state.open);
    state.open = null;
  };
  const start = (name: string, at: number) => {
    close();
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    state.open = { name: count > 1 ? `${name}#${count}` : name, from: at, to: at };
  };
  lines.forEach((line, at) => {
    const fence = FENCE.test(line);
    const heading = fenced || fence ? null : HEADING.exec(line);
    if (heading) {
      const text = label(heading[2] as string);
      headings.enter((heading[1] as string).length, text);
      start(headings.path() || text, at);
      close();
    } else if (!fenced && !line.trim()) {
      close();
    } else if (!state.open || (!fenced && ITEM.test(line))) {
      start(headings.path(label(line)), at);
    } else {
      state.open.to = at;
    }
    if (fence) fenced = !fenced;
  });
  close();
  return blocks;
}

// The block names a span of the text touches, less the span's own leading and trailing whitespace.
function touched(text: string, start: number, end: number, names: Set<string>) {
  const piece = text.slice(start, end);
  const from = start + (piece.length - piece.trimStart().length);
  const to = end - (piece.length - piece.trimEnd().length);
  if (to <= from) return;
  const first = text.slice(0, from).split("\n").length - 1;
  const last = first + text.slice(from, to).split("\n").length - 1;
  for (const block of markdownBlocks(text)) if (block.from <= last && block.to >= first) names.add(block.name);
}

// The blocks an Edit touches, in the text as it is and as it will be: a bullet inserted beside another is
// this card's too, so a commit by another card leaves it out (lib/commit-held.ts). Null for the whole file:
// old_string isn't there (or is empty), or the edit only moves whitespace between blocks.
export function markdownSymbolsFor(text: string, oldString: string, newString: string, replaceAll = false): string[] | null {
  if (!oldString) return null;
  const names = new Set<string>();
  const inserted: [number, number][] = [];
  let after = "";
  let copied = 0;
  for (let at = text.indexOf(oldString); at >= 0; at = replaceAll ? text.indexOf(oldString, at + oldString.length) : -1) {
    touched(text, at, at + oldString.length, names);
    after += text.slice(copied, at);
    inserted.push([after.length, after.length + newString.length]);
    after += newString;
    copied = at + oldString.length;
  }
  if (!inserted.length) return null;
  after += text.slice(copied);
  for (const [start, end] of inserted) touched(after, start, end, names);
  return names.size ? [...names] : null;
}
