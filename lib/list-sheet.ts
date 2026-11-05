// The board's list view on @aimhuge/sheet: what each of its columns holds for a card — the title, what
// it's doing, its stage, tags, folder and age — and the kit's sorts and filters with the board's names. Pure, so the
// list view (components/BoardList.tsx) only draws what this works out.
import { activeAt } from "./board-view";
import { folderName, STAGES } from "./format";
import type { Card, Column } from "./types";
import {
  BLANK,
  filterCountOf,
  parseSheet,
  rowPasses,
  sortItems,
  type SheetSpec,
  type SheetStateOf,
} from "@aimhuge/sheet";

export type SheetKey = "title" | "status" | "stage" | "tags" | "folder" | "age";
export type SheetSort = { key: SheetKey; dir: "asc" | "desc" } | null;
export type SheetHidden = Partial<Record<SheetKey, string[]>>;
// A band of the sheet: a board column, or the ⏰ Crons band at its foot.
export type Band = Column | "crons";
// The Backlog starts folded: it is the longest band and the least urgent.
export type SheetState = SheetStateOf<SheetKey, Band>;

export const SHEET_KEYS: SheetKey[] = ["title", "status", "stage", "tags", "folder", "age"];
export { BLANK };
// The Tags filter's value for a cron's run, so the sheet can be cut down to the crons (lib/list-crons.ts).
export const CRON_TAG = "⏰ cron";
export const EMPTY_SHEET: SheetState = { sort: null, hidden: {}, query: "", collapsed: ["backlog"] };

// What the thread is doing right now: an error, a wait, a prompt for you, or a running turn.
export interface RowStatus {
  word: string;
  tone?: string;
  icon: "alert" | "lock";
  tip?: string;
  spinner?: boolean;
}

export function rowStatus(card: Card): RowStatus | null {
  if (card.error) return { word: "Error", tone: "text-danger", icon: "alert", tip: card.error };
  if (card.pending?.waiting) return { word: "Waiting", tone: "text-warn", icon: "lock", tip: "Waiting on another card's code" };
  if (card.pending) {
    // The card is asking the user something: a permission, or a question.
    return card.pending.questions
      ? { word: "Question", tone: "text-warn", icon: "lock", tip: card.pending.title }
      : { word: "Permission", tone: "text-warn", icon: "lock", tip: card.pending.title };
  }
  if (card.column === "running") return { word: "Running", icon: "alert", spinner: true };
  if (card.column === "needs_you") return { word: "Needs you", tone: "text-warn", icon: "alert", tip: card.lastLine };
  return null;
}

// The order a column's values sort and list in, where it isn't A→Z: the loudest status first, the
// stages in the order a card goes through them, the newest age first.
const STATUS_ORDER = ["Error", "Permission", "Question", "Needs you", "Running", "Waiting"];
const AGE_BUCKETS: { label: string; under: number }[] = [
  { label: "Last hour", under: 3_600_000 },
  { label: "Today", under: 86_400_000 },
  { label: "This week", under: 7 * 86_400_000 },
];
const AGE_ORDER = [...AGE_BUCKETS.map((b) => b.label), "Older"];

function ageBucket(card: Card, now: number) {
  const age = Math.max(0, now - activeAt(card));
  return AGE_BUCKETS.find((b) => age < b.under)?.label ?? "Older";
}

// A card's tags, and ⏰ cron for a cron's run.
function tagValues(card: Card): string[] {
  const tags = [...(card.tags ?? []), ...(card.cronId ? [CRON_TAG] : [])];
  return tags.length ? tags : [BLANK];
}

// The values a card has in a column, as the filter checklist names them. Tags can be several.
export function cellValues(card: Card, key: SheetKey, now: number): string[] {
  switch (key) {
    case "title":
      return [card.title];
    case "status":
      return [rowStatus(card)?.word ?? BLANK];
    case "stage":
      return [card.stage || BLANK];
    case "tags":
      return tagValues(card);
    case "folder":
      return [card.role === "copilot" ? "whole board" : folderName(card.cwd)];
    case "age":
      return [ageBucket(card, now)];
  }
}

// A value's place in its column's order: the loudest status first, the stages in the order a card goes through them.
function stageRank(value: string) {
  const i = (STAGES as readonly string[]).indexOf(value);
  return i < 0 ? STAGES.length : i;
}

// The board's columns. Age sorts by the real time (youngest first ascending) and filters by bucket.
export const BOARD_SHEET: SheetSpec<Card, SheetKey> = {
  search: { key: "title", text: (card) => card.title, placeholder: "Type to filter titles…", hint: "Every word you type must be in the title", noun: ["card", "cards"] },
  columns: [
    { key: "title", label: "Title", values: (card, now) => cellValues(card, "title", now) },
    { key: "status", label: "Status", filter: true, values: (card, now) => cellValues(card, "status", now), rank: (v) => STATUS_ORDER.indexOf(v) },
    { key: "stage", label: "Stage", filter: true, values: (card, now) => cellValues(card, "stage", now), rank: stageRank },
    { key: "tags", label: "Tags", filter: true, values: (card, now) => cellValues(card, "tags", now) },
    { key: "folder", label: "Folder", filter: true, values: (card, now) => cellValues(card, "folder", now) },
    {
      key: "age",
      label: "Age",
      filter: true,
      flip: true,
      right: true,
      sortNames: ["Newest first", "Oldest first"],
      values: (card, now) => cellValues(card, "age", now),
      number: (card, now) => now - activeAt(card),
      rank: (v) => AGE_ORDER.indexOf(v),
    },
  ],
};

// Sorts a group's cards by one column. Blanks stay at the bottom either way, as in Sheets, and a tie
// keeps the board's own order, so an unsorted column still reads newest first.
export function sortBy<T>(items: T[], cardOf: (item: T) => Card, sort: SheetSort, now: number): T[] {
  return sortItems(items, cardOf, BOARD_SHEET, sort, now);
}

// Whether a card passes the sheet's filters: the title search and every filtered column.
export function rowMatches(card: Card, hidden: SheetHidden, query: string, now: number) {
  return rowPasses(card, BOARD_SHEET, hidden, query, now);
}

export const filterCount = (hidden: SheetHidden, query = "") => filterCountOf(hidden, query);

const BAND_IDS: Band[] = ["running", "needs_you", "review", "backlog", "done", "crons"];

// The saved sheet, read back from localStorage; anything unreadable is a fresh sheet.
export function parseSheetState(raw: string | null): SheetState {
  return parseSheet(raw, SHEET_KEYS, BAND_IDS, EMPTY_SHEET);
}
