import fs from "node:fs";
import path from "node:path";
import type { DiffLine, EditPreview } from "./edit-preview-types";

// What a held Edit, MultiEdit, Write or NotebookEdit would change, for the permission prompt
// (components/PermissionInput.tsx): the file, the symbols it touches, lines added and removed, and a short
// line diff, so the user reads the change instead of escaped JSON. Built on the server when the prompt
// is asked (lib/runner-ask.ts); a Write diffs against the file on disk.

// The preview's shapes live in lib/edit-preview-types.ts (types only, no node:fs), so the thread's items
// can carry them (lib/types-thread.ts) without dragging this module into the browser chunk. Re-exported
// here: the server's own imports of "./edit-preview" keep working.
export type { DiffLine, EditPreview };

export const DIFF_CAP = 40;

// Past this many cells the LCS table costs too much (a Write of a big file): plain - then + instead.
const LCS_CELLS = 250_000;

const split = (s: string) => (s === "" ? [] : s.replace(/\n$/, "").split("\n"));

// A line diff of a against b: common lines first and last kept as context, the middle by LCS.
export function lineDiff(a: string, b: string): DiffLine[] {
  const x = split(a);
  const y = split(b);
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
  const xs = x.slice(head, x.length - tail);
  const ys = y.slice(head, y.length - tail);
  const ctx = (lines: string[]): DiffLine[] => lines.map((text) => ({ kind: " ", text }));
  return [...ctx(x.slice(0, head)), ...middle(xs, ys), ...ctx(x.slice(x.length - tail))];
}

function middle(xs: string[], ys: string[]): DiffLine[] {
  const minus = xs.map((text): DiffLine => ({ kind: "-", text }));
  const plus = ys.map((text): DiffLine => ({ kind: "+", text }));
  if (!xs.length || !ys.length || xs.length * ys.length > LCS_CELLS) return [...minus, ...plus];
  // lcs(i, j): the longest common run of xs[i..] and ys[j..], in one flat table.
  const w = ys.length + 1;
  const table = new Int32Array((xs.length + 1) * w);
  const lcs = (i: number, j: number) => table[i * w + j] as number;
  for (let i = xs.length - 1; i >= 0; i--) {
    for (let j = ys.length - 1; j >= 0; j--) {
      table[i * w + j] = xs[i] === ys[j] ? lcs(i + 1, j + 1) + 1 : Math.max(lcs(i + 1, j), lcs(i, j + 1));
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < xs.length && j < ys.length) {
    // In range, so String() only narrows the type.
    const x = String(xs[i]);
    if (x === ys[j]) {
      out.push({ kind: " ", text: x });
      i++;
      j++;
    } else if (lcs(i + 1, j) >= lcs(i, j + 1)) out.push({ kind: "-", text: xs[i++] as string });
    else out.push({ kind: "+", text: ys[j++] as string });
  }
  return [...out, ...minus.slice(i), ...plus.slice(j)];
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

function readFile(file: string) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

// The diff of each change the tool call makes, one after another.
function diffsOf(toolName: string, input: Record<string, unknown>, file: string): { lines: DiffLine[]; creates?: boolean } | undefined {
  if (toolName === "Edit") return { lines: lineDiff(str(input.old_string), str(input.new_string)) };
  if (toolName === "MultiEdit") {
    const edits: unknown[] = Array.isArray(input.edits) ? input.edits : [];
    const field = (e: unknown, key: string) => (e && typeof e === "object" ? str((e as Record<string, unknown>)[key]) : "");
    return { lines: edits.flatMap((e) => lineDiff(field(e, "old_string"), field(e, "new_string"))) };
  }
  if (toolName === "Write") {
    const before = readFile(file);
    return { lines: lineDiff(before ?? "", str(input.content)), creates: before === undefined };
  }
  if (toolName === "NotebookEdit") return { lines: lineDiff("", str(input.new_source)) };
  return undefined;
}

// The preview for a file-editing tool call, or undefined for any other tool.
export function editPreview(toolName: string, input: Record<string, unknown>, cwd: string, symbols?: string[]): EditPreview | undefined {
  const given = str(input.file_path) || str(input.notebook_path);
  if (!given) return undefined;
  const abs = path.resolve(cwd, given);
  const diff = diffsOf(toolName, input, abs);
  if (!diff) return undefined;
  const rel = path.relative(cwd, abs);
  const changed = (k: DiffLine["kind"]) => diff.lines.filter((l) => l.kind === k).length;
  return {
    file: rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : abs,
    symbols: symbols?.length ? symbols : undefined,
    added: changed("+"),
    removed: changed("-"),
    lines: diff.lines.slice(0, DIFF_CAP),
    more: Math.max(0, diff.lines.length - DIFF_CAP),
    creates: diff.creates || undefined,
  };
}

