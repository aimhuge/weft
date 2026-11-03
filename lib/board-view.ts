// What the board shows, worked out from the cards: columns, project summaries, sort orders, and what a
// card's move should set off. Pure, so Board.tsx keeps only state and rendering.
import type { ChimeKind } from "./chimes";
import type { FilterMatch as ClientFilterMatch, ListGroup as ClientListGroup, ListRow as ClientListRow } from "@weft/client";
import type { Card, CardStats, Column } from "./types";

// The grouping (sorts, filters, columns, the list view, project summaries) lives in @weft/client
// (packages/weft-client/src/board-group.ts); the generic shapes are bound to the app's Card here.
export {
  activeAt,
  backlogSorter,
  cardLooksLikeError,
  cardLooksLikeSessionLimit,
  groupByColumn,
  listGroups,
  listRows,
  NO_REVIEW_FILTER,
  reviewFilterCounts,
  reviewKeeps,
  shownColumn,
  SORTERS,
  summarizeProjects,
  topMatches,
  type BoardView,
  type ProjectSummary,
  type ProjectWorker,
  type ReviewFilter,
  type ReviewFilterKey,
  type SortKey,
  type WorkerProjectStatus,
} from "@weft/client";
export type FilterMatch = ClientFilterMatch<Card>;
export type ListRow = ClientListRow<Card>;
export type ListGroup = ClientListGroup<Card>;

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
