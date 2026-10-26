// What the board shows, worked out from the cards: columns, project summaries, sort orders, and what a
// card's move should set off. Pure, so Board.tsx keeps only state and rendering.
import type { ChimeKind } from "./chimes";
import { COLUMNS, type Card, type CardStats, type Column, type Project } from "./types";

export type SortKey = "newest" | "active" | "oldest";

export interface ProjectSummary {
  path: string; // absolute folder path
  lastActivity: number; // ms timestamp, used for ordering (already sorted most recent first)
  cards: number; // total cards in that folder
  running: number; // cards in the Running column
  needsYou: number; // unarchived cards in the Needs you column
  pinned?: boolean; // always a chip, ahead of the recent ones (lib/project-menu.ts)
  hidden?: boolean; // no chip until it's used again; "More" still lists it
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
export function cardLooksLikeError(card: Card): boolean {
  return /^\s*(error:|build error\b)/i.test(card.lastLine ?? "");
}

// "You've hit your session limit · resets 10:40pm (Asia/Bangkok)": a turn cut off by the 5-hour cap.
export function cardLooksLikeSessionLimit(card: Card): boolean {
  return /hit your session limit\s*·\s*resets/i.test(card.lastLine ?? "");
}

const REVIEW_MATCHERS: Record<ReviewFilterKey, (card: Card) => boolean> = {
  errors: cardLooksLikeError,
  restart: cardLooksLikeSessionLimit,
};

// Which Review cards the chips let through: every card with no chip on, else those matching any chip that is.
export function reviewKeeps(filter: ReviewFilter = NO_REVIEW_FILTER): (card: Card) => boolean {
  const on = (Object.keys(REVIEW_MATCHERS) as ReviewFilterKey[]).filter((k) => filter[k]);
  return (card) => !on.length || on.some((k) => REVIEW_MATCHERS[k](card));
}

// How many of these cards each chip matches, for the count on an active chip.
export function reviewFilterCounts(cards: Card[]): Record<ReviewFilterKey, number> {
  return {
    errors: cards.filter(cardLooksLikeError).length,
    restart: cards.filter(cardLooksLikeSessionLimit).length,
  };
}

// When a card's thread last moved. A card picked up from Claude Code carries its session's last message
// time; its updatedAt also changes when the board only reads the transcript.
export const activeAt = (card: Card) => card.lastActivity ?? card.updatedAt;

export const SORTERS: Record<SortKey, (a: Card, b: Card) => number> = {
  newest: (a, b) => b.createdAt - a.createdAt,
  active: (a, b) => activeAt(b) - activeAt(a),
  oldest: (a, b) => a.createdAt - b.createdAt,
};

// Backlog uses each card's `order` so the user can drag cards into a chosen sequence.
// Smaller numbers come first; ties (cards without an order yet, or matching numbers) fall
// back to the column's chosen sort so an unmoved card still sits next to its peers.
export function backlogSorter(view: BoardView): (a: Card, b: Card) => number {
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
export interface FilterMatch {
  card: Card;
  matchedTag?: string;
}

export function groupByColumn(cards: Card[], view: BoardView, rootOf: (cwd: string) => string) {
  const { tagNeedle, haystack } = queryShape(view.query);
  const cardMatches = (card: Card) => {
    const tags = card.tags ?? [];
    if (tagNeedle) return tags.some((t) => t.toLowerCase() === tagNeedle);
    if (!haystack) return true;
    return [card.title, card.prompt, card.lastLine, card.stage, card.remaining, ...tags]
      .join(" ")
      .toLowerCase()
      .includes(haystack);
  };
  const keepReview = reviewKeeps(view.reviewFilter);
  const groups = new Map<Column, Card[]>(COLUMNS.map((c) => [c.id, []]));
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
function columnSorter(column: Column, view: BoardView): (a: Card, b: Card) => number {
  if (column === "backlog") return backlogSorter(view);
  if (column === "review") return SORTERS.active;
  return SORTERS[view.sort];
}

// Where the board draws a card: a running one that's wrapping up (/done) already sits in Done.
export function shownColumn(card: Card): Column {
  return card.wrappingUp && card.column === "running" ? "done" : card.column;
}

// The cards a filter matches, most recently active first, for the filter box's quick-open list.
// When the query is a `tag:foo` or a free-text hit that landed in the card's tags, `matchedTag`
// names the tag that caused the match (the first one, case-insensitive); otherwise it's unset.
// `query` is optional so callers that don't have it handy still get the list (without the chip).
export function topMatches(groups: Map<Column, Card[]>, limit: number, query = ""): FilterMatch[] {
  const { tagNeedle, haystack } = queryShape(query);
  const list = [...groups.values()].flat();
  const enriched: FilterMatch[] = list.map((card) => {
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
export interface ListRow {
  card: Card;
  column: Column;
}

// One group of the list view: a column's cards, under the column's name.
export interface ListGroup {
  column: Column;
  label: string;
  cards: Card[];
}

// The list view's rows: every card the board shows, in column order (Backlog, Running, Needs you,
// Review, Done) and each column's own sort within it, so the list reads like the board does. Cards
// from a column the board hides (Backlog, when it's off) still show here: the list is the whole board.
export function listRows(groups: Map<Column, Card[]>): ListRow[] {
  const rows: ListRow[] = [];
  for (const column of COLUMNS) {
    for (const card of groups.get(column.id) ?? []) rows.push({ card, column: column.id });
  }
  return rows;
}

// The list view's groups: one per column that has cards, in the same column order as listRows. The
// list draws a heading for each, so a row never has to name its own column.
export function listGroups(groups: Map<Column, Card[]>): ListGroup[] {
  const out: ListGroup[] = [];
  for (const column of COLUMNS) {
    const cards = groups.get(column.id) ?? [];
    if (cards.length) out.push({ column: column.id, label: column.label, cards });
  }
  return out;
}

// Recent projects: saved ones plus every folder a card runs in, most recently active first. Worktrees
// count toward their main repo and never get a chip of their own.
export function summarizeProjects(projects: Project[], cards: Card[], rootOf: (cwd: string) => string) {
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

// The most recent card's stats, plus the folder and backend the stats came from: the board's working
// folder when no card is open (lib/board-derive.ts workFolder). Plan limits come from the limits log
// instead (lib/plan-limits.ts).
export function latestLimits(cards: Card[]): (CardStats & { cwd: string; backend: Card["backend"] }) | undefined {
  const withStats = cards.filter((c) => c.stats);
  const latest = withStats.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!latest) return undefined;
  return { ...latest.stats, cwd: latest.cwd, backend: latest.backend };
}

// Whether a thread on the board hit its CLI's plan limit, so the Running and Needs you columns
// offer "Switch all" to the other CLI only when there's a reason to switch.
export function hitPlanLimit(cards: Card[]): boolean {
  return cards.some((c) => c.rateLimitHit && !c.archived);
}

// The item `by` steps away from `current`, wrapping at both ends; an unknown current counts as the first.
export function stepThrough<T>(options: readonly T[], current: T, by: number): T {
  const at = Math.max(0, options.indexOf(current));
  const next = options[(at + by + options.length) % options.length];
  return next === undefined ? current : next;
}

export const RECENT_MOVE_MS = 24 * 60 * 60 * 1000;

// The cards that moved column lately, latest move first: what the command palette opens on.
export function recentMoves(cards: Card[], now: number, limit = 5): Card[] {
  return cards
    .filter((c) => c.role !== "copilot" && c.columnAt !== undefined && now - c.columnAt < RECENT_MOVE_MS)
    .toSorted((a, b) => (b.columnAt ?? 0) - (a.columnAt ?? 0))
    .slice(0, limit);
}

// Columns whose arrival marks a card unseen: the ones that want you to look.
export const UNSEEN_COLUMNS: Column[] = ["needs_you", "review", "done"];

// A move you just made yourself doesn't chime; only changes the board or an agent makes do.
export const OWN_MOVE_MS = 3000;

export interface CardChange {
  previous: Column | undefined; // the column last seen, undefined the first time the card shows up
  column: Column;
  previousError: string | undefined;
  error: string | undefined;
  own: { column: Column; at: number } | undefined; // a move you made from this board
  now: number;
  open: boolean; // the card's thread is open
}

// What a card event should set off. A card seen for the first time sets off nothing.
export function cardChangeEffects(change: CardChange) {
  const { previous, column, own } = change;
  const moved = Boolean(previous && previous !== column);
  const mine = moved && own?.column === column && change.now - own.at < OWN_MOVE_MS;
  return {
    moved,
    chime: moved && !mine && column !== "backlog" ? (column as ChimeKind) : null,
    markUnseen: moved && !mine && UNSEEN_COLUMNS.includes(column) && !change.open,
    errorChime: Boolean(previous && change.error && change.error !== change.previousError),
  };
}
