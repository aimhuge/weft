"use client";

// A column's band in the list view: its name, its count and its colour across the sheet's width. A click
// folds it or opens it; the Backlog and Running bands carry a + that opens them with the cursor in the
// quick add (components/SheetQuickAdd.tsx).
import { COLUMN_TONE } from "@/lib/column-tone";
import type { SheetGroup } from "@/lib/list-tree";
import { Chevron } from "./CardRowCells";

// The Done band's Show archived toggle, the list's twin of the Done column header's (components/ColumnHeader.tsx).
export interface BandArchive {
  count: number;
  shown: boolean;
  onToggle: () => void;
}

export default function SheetBand({ group, onFold, onAdd, archive }: { group: SheetGroup; onFold: () => void; onAdd?: () => void; archive?: BandArchive }) {
  const tone = COLUMN_TONE[group.column];
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
      {archive && archive.count > 0 && (
        <button onClick={archive.onToggle} aria-pressed={archive.shown} title="Archived cards show in every band" className="sheet-band-add">
          {archive.shown ? "Hide archived" : `Show ${archive.count} archived`}
        </button>
      )}
    </div>
  );
}
