import type { Card } from "./types";
import { workDir } from "./work-dir";

// Busy-folder warnings: Weft gives cards no git worktree of their own (see SOUL.md), so two cards
// working in one folder share a working tree. These helpers find the other busy cards in a card's
// folder, and the files they've both edited, from the board data alone, with no git calls, so they
// cost nothing on the start-a-card path.

// "/a/b/" -> "/a/b", so trailing slashes don't hide a match.
function trim(cwd: string) {
  return cwd.length > 1 ? cwd.replace(/\/+$/, "") : cwd;
}

// The Claude Code worktree a folder sits in, if any: a separate working tree, so no clash with its repo.
function worktreeOf(cwd: string) {
  return /^.+?\/\.claude\/worktrees\/[^/]+(?=\/|$)/.exec(cwd)?.[0];
}

function inside(child: string, parent: string) {
  return child === parent || child.startsWith(parent === "/" ? "/" : `${parent}/`);
}

// Whether two folders share a working tree: the same folder, or one inside the other, and not split
// apart by a worktree.
export function sameTree(a: string, b: string) {
  const x = trim(a);
  const y = trim(b);
  if (!inside(x, y) && !inside(y, x)) return false;
  return worktreeOf(x) === worktreeOf(y);
}

export function isBusy(card: Card) {
  return (card.column === "running" || card.column === "needs_you") && !card.archived && card.role !== "copilot";
}

// Busy cards in a folder, plus the files they share with the card asked about (if any), so the
// warning spots can render alsoHereLine(others) without being handed the card too.
export type BusyCards = Card[] & { sharedFiles?: string[] };

// The other busy cards working in this folder (pass the card's id to leave it out). An isolated card works in its
// worktree (lib/work-dir.ts), so it's only "here" for a folder inside that worktree.
export function busyInFolder(cards: Card[], cwd: string, exceptId?: string) {
  return cards.filter((c) => c.id !== exceptId && isBusy(c) && sameTree(workDir(c), cwd));
}

// The other busy cards in this card's folder, the ones that edited the same files as it first.
export function busyHere(cards: Card[], card: Card): BusyCards {
  const others = busyInFolder(cards, workDir(card), card.id);
  const overlapping = others.filter((c) => sharedFiles(card, [c]).length > 0);
  if (overlapping.length === 0) return others;
  const ordered: BusyCards = [...overlapping, ...others.filter((c) => !overlapping.includes(c))];
  ordered.sharedFiles = sharedFiles(card, overlapping);
  return ordered;
}

// How many edited files a card remembers (see touchFile).
export const TOUCHED_CAP = 50;

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

// The file a tool call edits, for the tools that edit files; paths stay as given (absolute).
export function editedPath(toolName: string, input: Record<string, unknown>) {
  if (!EDIT_TOOLS.has(toolName)) return undefined;
  const path = input.file_path ?? input.notebook_path;
  return typeof path === "string" && path ? path : undefined;
}

// The card's edited files with this one moved to the front, or undefined when that changes nothing
// (it's already first), so the caller can skip the write.
export function touchFile(list: string[] | undefined, path: string) {
  if (list?.[0] === path) return undefined;
  return [path, ...(list ?? []).filter((p) => p !== path)].slice(0, TOUCHED_CAP);
}

// The files this card edited that any of the others edited too, in the card's order (most recent first).
export function sharedFiles(card: Card, others: Card[]) {
  const theirs = new Set(others.flatMap((c) => c.touchedFiles ?? []));
  return (card.touchedFiles ?? []).filter((p) => theirs.has(p));
}

function basename(path: string) {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

// "a.ts", "a.ts and b.ts", "a.ts, b.ts and 3 more".
export function filesLine(paths: string[]) {
  const names = paths.slice(0, 2).map(basename);
  const more = paths.length - names.length;
  if (more > 0) return `${names.join(", ")} and ${more} more`;
  return names.join(" and ");
}

// "Also running here: Fix login", "Also running here: Fix login and 2 more", and when busyHere found
// shared edits, "Also running here: Fix login — both edited a.ts".
export function alsoHereLine(others: BusyCards) {
  const first = others[0];
  if (!first) return "";
  const more = others.length - 1;
  const line = `Also running here: ${first.title}${more ? ` and ${more} more` : ""}`;
  const shared = others.sharedFiles ?? [];
  if (shared.length === 0) return line;
  return `${line} — both edited ${filesLine(shared)}`;
}
