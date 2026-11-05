// Board grouping: which cards a board shows in which column, in what order, and the project summaries, worked out
// from the cards alone so the desktop board, weft.zip and the phone group a board the same way. The app's
// lib/board-view.ts re-exports these with its Card filled in for the generic ones; the move rules (chimes, unseen)
// stay there.
import { COLUMNS, type Column } from "./card";

// The part of a card the grouping reads; the app's Card is one.
export interface BoardCard {
  title: string;
  prompt: string;
  cwd: string;
  column: Column;
  archived?: boolean;
  order?: number;
  wrappingUp?: boolean;
  lastLine?: string;
  stage?: string;
  remaining?: string;
  lastActivity?: number;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

// The part of a saved project the project summaries read; the app's Project is one.
export interface BoardProject {
  path: string;
  lastUsedAt: number;
  pinned?: boolean;
  hidden?: boolean;
  folders?: string[];
}

export type SortKey = "newest" | "active" | "oldest";

export interface ProjectSummary {
  path: string; // absolute folder path
  lastActivity: number; // ms timestamp, used for ordering (already sorted most recent first)
  cards: number; // total cards in that folder
  running: number; // cards in the Running column
  needsYou: number; // unarchived cards in the Needs you column
  pinned?: boolean; // always a chip, ahead of the recent ones (the app's lib/project-menu.ts)
  hidden?: boolean; // no chip until it's used again; "More" still lists it
  worker?: ProjectWorker; // it lives on a Weft Worker, not on this Mac (the app's lib/worker-project.ts)
  folders?: string[]; // folders added to it ("Add Folder…", lib/project-folders.ts)
}

export type WorkerProjectStatus = "online" | "busy" | "offline";

export interface ProjectWorker {
  name: string;
  status: WorkerProjectStatus;
}

export interface BoardView {
  project: string | null;
  query: string;
  sort: SortKey;
  showArchived: boolean;
  // The Review column's quick filters; unset (the web board) leaves Review whole.
  reviewFilter?: ReviewFilter;
}

// Review's two strict chips: Errors keeps cards whose turn ended in an error, Restart keeps cards that hit
// the 5-hour session limit. Both on keeps either kind.
export interface ReviewFilter {
  errors: boolean;
  restart: boolean;
}
export type ReviewFilterKey = keyof ReviewFilter;
export const NO_REVIEW_FILTER: ReviewFilter = { errors: false, restart: false };

// A thread error ("error: Claude Code process exited with code 1") or a build error the turn reported.
export function cardLooksLikeError(card: BoardCard): boolean {
  return /^\s*(error:|build error\b)/i.test(card.lastLine ?? "");
}

// "You've hit your session limit · resets 10:40pm (Asia/Bangkok)": a turn cut off by the 5-hour cap.
export function cardLooksLikeSessionLimit(card: BoardCard): boolean {
  return /hit your session limit\s*·\s*resets/i.test(card.lastLine ?? "");
}

const REVIEW_MATCHERS: Record<ReviewFilterKey, (card: BoardCard) => boolean> = {
  errors: cardLooksLikeError,
  restart: cardLooksLikeSessionLimit,
};

// Which Review cards the chips let through: every card with no chip on, else those matching any chip that is.
export function reviewKeeps(filter: ReviewFilter = NO_REVIEW_FILTER): (card: BoardCard) => boolean {
  const on = (Object.keys(REVIEW_MATCHERS) as ReviewFilterKey[]).filter((k) => filter[k]);
  return (card) => !on.length || on.some((k) => REVIEW_MATCHERS[k](card));
}

// How many of these cards each chip matches, for the count on an active chip.
export function reviewFilterCounts(cards: BoardCard[]): Record<ReviewFilterKey, number> {
  return {
    errors: cards.filter(cardLooksLikeError).length,
    restart: cards.filter(cardLooksLikeSessionLimit).length,
  };
}

// When a card's thread last moved. A card picked up from Claude Code carries its session's last message
// time; its updatedAt also changes when the board only reads the transcript.
export const activeAt = (card: BoardCard) => card.lastActivity ?? card.updatedAt;

export const SORTERS: Record<SortKey, (a: BoardCard, b: BoardCard) => number> = {
  newest: (a, b) => b.createdAt - a.createdAt,
  active: (a, b) => activeAt(b) - activeAt(a),
  oldest: (a, b) => a.createdAt - b.createdAt,
};

// Backlog uses each card's `order` so the user can drag cards into a chosen sequence.
// Smaller numbers come first; ties (cards without an order yet, or matching numbers) fall
// back to the column's chosen sort so an unmoved card still sits next to its peers.
export function backlogSorter(view: BoardView): (a: BoardCard, b: BoardCard) => number {
  const fallback = SORTERS[view.sort];
  return (a, b) => {
    const ao = a.order;
    const bo = b.order;
    if (typeof ao === "number" && typeof bo === "number" && ao !== bo) return ao - bo;
    return fallback(a, b);
  };
}

// The board's columns: the cards in the chosen project that match the filter, each column sorted.
// rootOf folds a worktree into its main repo, so its cards show under that project.
// What a free-text query is asking for. `tag:foo` narrows to a single tag (case-insensitive,
// whitespace tolerated); an empty query matches everything. `haystack` is the lowercased needle
// to look for in a card's title/prompt/lastLine/stage/remaining/tags, or null when the query is
// a tag-only filter or empty.
function queryShape(raw: string): { tagNeedle: string | null; haystack: string | null } {
  const trimmed = raw.trim();
  const tagOnly = /^tag:\s*(.+)$/i.exec(trimmed);
  if (tagOnly?.[1]) return { tagNeedle: tagOnly[1].trim().toLowerCase(), haystack: null };
  if (!trimmed) return { tagNeedle: null, haystack: null };
  return { tagNeedle: null, haystack: trimmed.toLowerCase() };
}

// A card the filter dropped into the dropdown, plus the tag that matched (if any), so the row
// can show *why* it's in the result.
export interface FilterMatch<C extends BoardCard = BoardCard> {
  card: C;
  matchedTag?: string;
}

export function groupByColumn<C extends BoardCard>(cards: C[], view: BoardView, rootOf: (cwd: string) => string) {
  const { tagNeedle, haystack } = queryShape(view.query);
  const cardMatches = (card: C) => {
    const tags = card.tags ?? [];
    if (tagNeedle) return tags.some((t) => t.toLowerCase() === tagNeedle);
    if (!haystack) return true;
    return [card.title, card.prompt, card.lastLine, card.stage, card.remaining, ...tags]
      .join(" ")
      .toLowerCase()
      .includes(haystack);
  };
  const keepReview = reviewKeeps(view.reviewFilter);
  const groups = new Map<Column, C[]>(COLUMNS.map((c) => [c.id, []]));
  for (const card of cards) {
    if (view.project && rootOf(card.cwd) !== view.project) continue;
    if (card.archived && !view.showArchived) continue;
    if (!cardMatches(card)) continue;
    const column = shownColumn(card);
    if (column === "review" && !keepReview(card)) continue;
    groups.get(column)?.push(card);
  }
  for (const [column, list] of groups) list.sort(columnSorter(column, view));
  return groups;
}

// Backlog keeps the user's dragged order; Review always shows the most recently updated card first, so
// the turn that just finished is on top whatever the board's sort; the rest follow the chosen sort.
function columnSorter(column: Column, view: BoardView): (a: BoardCard, b: BoardCard) => number {
  if (column === "backlog") return backlogSorter(view);
  if (column === "review") return SORTERS.active;
  return SORTERS[view.sort];
}

// Where the board draws a card: a running one that's wrapping up (/done) already sits in Done.
export function shownColumn(card: BoardCard): Column {
  return card.wrappingUp && card.column === "running" ? "done" : card.column;
}

// The cards a filter matches, most recently active first, for the filter box's quick-open list.
// When the query is a `tag:foo` or a free-text hit that landed in the card's tags, `matchedTag`
// names the tag that caused the match (the first one, case-insensitive); otherwise it's unset.
// `query` is optional so callers that don't have it handy still get the list (without the chip).
export function topMatches<C extends BoardCard>(groups: Map<Column, C[]>, limit: number, query = ""): FilterMatch<C>[] {
  const { tagNeedle, haystack } = queryShape(query);
  const list = [...groups.values()].flat();
  const enriched: FilterMatch<C>[] = list.map((card) => {
    const tags = card.tags ?? [];
    if (tagNeedle) {
      const hit = tags.find((t) => t.toLowerCase() === tagNeedle);
      return hit ? { card, matchedTag: hit } : { card };
    }
    if (haystack) {
      const hit = tags.find((t) => t.toLowerCase().includes(haystack));
      if (hit) return { card, matchedTag: hit };
    }
    return { card };
  });
  return enriched.toSorted((a, b) => SORTERS.active(a.card, b.card)).slice(0, limit);
}

// One row of the list view: a card and the column it sits in, so the row can label itself.
export interface ListRow<C extends BoardCard = BoardCard> {
  card: C;
  column: Column;
}

// One group of the list view: a column's cards, under the column's name.
export interface ListGroup<C extends BoardCard = BoardCard> {
  column: Column;
  label: string;
  cards: C[];
}

// The list view's rows: every card the board shows, in column order (Backlog, Running, Needs you,
// Review, Done) and each column's own sort within it, so the list reads like the board does. Cards
// from a column the board hides (Backlog, when it's off) still show here: the list is the whole board.
export function listRows<C extends BoardCard>(groups: Map<Column, C[]>): ListRow<C>[] {
  const rows: ListRow<C>[] = [];
  for (const column of COLUMNS) {
    for (const card of groups.get(column.id) ?? []) rows.push({ card, column: column.id });
  }
  return rows;
}

// The list view's groups: one per column that has cards, in the same column order as listRows. The
// list draws a heading for each, so a row never has to name its own column.
export function listGroups<C extends BoardCard>(groups: Map<Column, C[]>): ListGroup<C>[] {
  const out: ListGroup<C>[] = [];
  for (const column of COLUMNS) {
    const cards = groups.get(column.id) ?? [];
    if (cards.length) out.push({ column: column.id, label: column.label, cards });
  }
  return out;
}

// Recent projects: saved ones plus every folder a card runs in, most recently active first. Worktrees
// count toward their main repo and never get a chip of their own.
export function summarizeProjects(projects: BoardProject[], cards: BoardCard[], rootOf: (cwd: string) => string) {
  const byPath = new Map<string, ProjectSummary>();
  const summary = (path: string) => {
    let s = byPath.get(path);
    if (!s) byPath.set(path, (s = { path, lastActivity: 0, cards: 0, running: 0, needsYou: 0 }));
    return s;
  };
  for (const p of projects) {
    const s = summary(rootOf(p.path));
    s.lastActivity = Math.max(s.lastActivity, p.lastUsedAt);
    if (p.pinned) s.pinned = true;
    if (p.hidden) s.hidden = true;
    if (p.folders?.length) s.folders = [...new Set([...(s.folders ?? []), ...p.folders])];
  }
  for (const card of cards) {
    const s = summary(rootOf(card.cwd));
    s.cards += 1;
    s.lastActivity = Math.max(s.lastActivity, activeAt(card));
    // An archived card is out of sight, so it doesn't light a project's running or needs-you dot.
    if (card.archived) continue;
    if (card.column === "running") s.running += 1;
    if (card.column === "needs_you") s.needsYou += 1;
  }
  return [...byPath.values()].sort((a, b) => b.lastActivity - a.lastActivity);
}

// The header's Running and Needs you counts; archived cards are hidden from the board, so not counted.
export function headerCounts(cards: BoardCard[]) {
  const live = cards.filter((c) => !c.archived);
  return {
    running: live.filter((c) => c.column === "running").length,
    waiting: live.filter((c) => c.column === "needs_you").length,
  };
}
