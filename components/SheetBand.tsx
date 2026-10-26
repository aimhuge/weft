"use client";

// A column's band in the list view: its name, its count and its colour across the sheet's width. A click
// folds it or opens it; the Backlog and Running bands carry a + that opens them with the cursor in the
// quick add (components/SheetQuickAdd.tsx).
import type { Column } from "@/lib/types";
import type { SheetGroup } from "@/lib/list-tree";
import { Chevron } from "./CardRowCells";

// Each column's colour, the same map the board's columns and card progress use.
const TONE: Record<Column, { text: string; dot: string }> = {
  running: { text: "text-accent", dot: "bg-accent" },
  needs_you: { text: "text-warn", dot: "bg-warn" },
  review: { text: "text-ok", dot: "bg-ok" },
  backlog: { text: "text-muted", dot: "bg-muted" },
  done: { text: "text-faint", dot: "bg-faint" },
};

export default function SheetBand({ group, onFold, onAdd }: { group: SheetGroup; onFold: () => void; onAdd?: () => void }) {
  const tone = TONE[group.column];
  return (
    <div className={`sheet-band sticky z-10 flex items-center text-[11px] font-semibold uppercase tracking-[0.08em] ${tone.text}`}>
      <button onClick={onFold} aria-expanded={!group.collapsed} className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left uppercase">
        <span className="text-faint">
          <Chevron open={!group.collapsed} />
        </span>
        <span className={`size-1.5 rounded-full ${tone.dot}`} aria-hidden />
        {group.label}
        <span className="font-normal tabular-nums text-faint">{group.shown === group.total ? group.total : `${group.shown} of ${group.total}`}</span>
        {group.collapsed && <span className="ml-auto font-normal normal-case tracking-normal text-faint">folded · click to show</span>}
      </button>
      {onAdd && (
        <button
          onClick={onAdd}
          aria-label={group.column === "backlog" ? "Add a card to the Backlog" : "Start a thread in Running"}
          title={group.column === "backlog" ? "Add a card: just type its title" : "Start a thread"}
          className="sheet-band-add"
        >
          + {group.column === "backlog" ? "Add" : "Start"}
        </button>
      )}
    </div>
  );
}
