// Which board columns spill into a second column of cards (components/BoardColumn.tsx `wide`). A column
// widens only when its cards don't fit its height, the fullest first, while the board still has room for
// one more column's width; folded columns (components/FoldedColumn.tsx) take only their strip.
import type { Column } from "./types";

// The widths components/BoardColumns.tsx and BoardColumn.tsx draw with: a column (w-[264px]), a wide one
// (w-[540px], two columns and the gap between), a folded strip (w-8), the gap (gap-3) and the board's padding (p-3).
export const COLUMN_WIDTH = 264;
export const WIDE_WIDTH = 540;
export const STRIP_WIDTH = 32;
const GAP = 12;
const PADDING = 24;
// A column's header and bottom padding, and roughly one card with the gap under it.
const HEADER = 48;
const CARD = 80;

export interface LaneSize {
  id: Column;
  count: number;
  folded: boolean;
}

export function wideColumns(width: number, height: number, lanes: readonly LaneSize[]): Column[] {
  const open = lanes.filter((l) => !l.folded);
  let used = PADDING + open.length * COLUMN_WIDTH + (lanes.length - open.length) * STRIP_WIDTH + GAP * Math.max(0, lanes.length - 1);
  const fits = Math.max(1, Math.floor((height - HEADER) / CARD));
  const wide: Column[] = [];
  // sort is stable, so columns with as many cards keep the board's order (Backlog before Done).
  for (const lane of [...open].sort((a, b) => b.count - a.count)) {
    if (lane.count <= fits || used + WIDE_WIDTH - COLUMN_WIDTH > width) break;
    used += WIDE_WIDTH - COLUMN_WIDTH;
    wide.push(lane.id);
  }
  return wide;
}
