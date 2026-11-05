// Each column's colour, in one place: the card's progress line (components/CardProgress.tsx), the list
// view's row cells (components/CardRowCells.tsx) and the list view's band (components/SheetBand.tsx) all
// read it, so a column that changes colour changes in one edit and the card and its band never disagree.
import type { Column } from "./types";

// The text colour a column's name and stage take, the bar the stage's steps fill with, and the dot
// the band's marker is drawn as — the same colour under three names.
export interface ColumnTone {
  text: string;
  bar: string;
  dot: string;
}

export const COLUMN_TONE: Record<Column, ColumnTone> = {
  running: { text: "text-accent", bar: "bg-accent", dot: "bg-accent" },
  needs_you: { text: "text-warn", bar: "bg-warn", dot: "bg-warn" },
  review: { text: "text-ok", bar: "bg-ok", dot: "bg-ok" },
  backlog: { text: "text-muted", bar: "bg-muted", dot: "bg-muted" },
  done: { text: "text-faint", bar: "bg-faint", dot: "bg-faint" },
};
