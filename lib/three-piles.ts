// Simple mode's three-pile board (docs/architecture/simple-mode.md #4): Needs you, Working and Ready as the
// board's full columns, in that order, with Backlog and Done folded into strips that keep their counts. Only the
// labels and the order change: the column ids, and so the BOARD STATUS protocol and weft.zip's grouping, stay.
import { isFolded, setColumnFolded } from "./board-prefs";
import type { Card, Column } from "./types";

type Lane = { id: Column; label: string };

// The board's order with the piece on: Backlog's strip first, the three piles, then Done's strip.
const ORDER: Column[] = ["backlog", "needs_you", "running", "review", "done"];
const LABELS: Partial<Record<Column, string>> = { running: "Working", review: "Ready" };
// The columns that start folded with the piece on, until you open them.
const STRIPS: Column[] = ["backlog", "done"];

// The given columns (whichever the board shows) in the three-pile order, Running and Review renamed.
export function threePileColumns(columns: readonly Lane[]): Lane[] {
  return [...columns]
    .sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id))
    .map((c) => ({ id: c.id, label: LABELS[c.id] ?? c.label }));
}

const OPEN_COOKIE = "weft-simple-opened-columns";
const EVENT = "weft-board-prefs";

// Backlog and Done when you opened their strip with the piece on, comma-separated: a string so
// useSyncExternalStore gets the same snapshot until it changes.
export function openedPiles(): string {
  if (typeof document === "undefined") return "";
  const set = new RegExp(`(?:^|; )${OPEN_COOKIE}=([^;]*)`).exec(document.cookie);
  return set?.[1] ? decodeURIComponent(set[1]) : "";
}

function setPileOpened(column: Column, open: boolean) {
  const rest = openedPiles().split(",").filter((c) => c && c !== column);
  const next = open ? [...rest, column] : rest;
  document.cookie = `${OPEN_COOKIE}=${encodeURIComponent(next.join(","))}; path=/; max-age=${10 * 365 * 24 * 60 * 60}; SameSite=Lax`;
  window.dispatchEvent(new Event(EVENT));
}

// Whether a column shows as a strip. With the piece off it's the usual fold cookie; with it on, Backlog and
// Done are strips unless you opened them, and the piles fold only from their own chevron.
export function pileFolded(piles: boolean, shut: string, opened: string, column: Column): boolean {
  if (piles && STRIPS.includes(column)) return !opened.split(",").includes(column);
  return isFolded(shut, column);
}

// Fold or open a column from its chevron or strip, into the cookie pileFolded reads for it.
export function foldColumn(piles: boolean, column: Column, fold: boolean) {
  if (piles && STRIPS.includes(column)) setPileOpened(column, !fold);
  else setColumnFolded(column, fold);
}

// One section of simple mode's sidebar (components/BoardSidebar.tsx): a column's cards under its header.
// A strip (Backlog, Done) shows only its header and count until you open it.
export type SidebarSection = { id: Column; label: string; cards: Card[]; strip: boolean; open: boolean };

// The board as the sidebar's sections: Needs you, Working and Ready first, then Backlog and Done, which
// open from the same cookie their strips on the board use (openedPiles).
export function sidebarSections(columns: readonly Lane[], byColumn: ReadonlyMap<Column, Card[]>, opened: string): SidebarSection[] {
  const lanes = threePileColumns(columns);
  const ordered = [...lanes.filter((l) => !STRIPS.includes(l.id)), ...lanes.filter((l) => STRIPS.includes(l.id))];
  return ordered.map((lane) => ({
    ...lane,
    cards: byColumn.get(lane.id) ?? [],
    strip: STRIPS.includes(lane.id),
    open: !pileFolded(true, "", opened, lane.id),
  }));
}
