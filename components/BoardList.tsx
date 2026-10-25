"use client";

// The list view: every card the board shows as one sheet — a table, with a header row and a line per
// card, the way a spreadsheet reads. The headers stay put while you scroll, the columns line up
// down the sheet, and the card you pick is tinted like the cell you picked in a grid.
import { useMemo } from "react";
import type { Card, Column } from "@/lib/types";
import { listGroups } from "@/lib/board-view";
import { LIST_GRID } from "./list-grid";

// Each column's colour, the same map the board's columns and card progress use.
const TONE: Record<Column, { text: string; dot: string }> = {
  running: { text: "text-accent", dot: "bg-accent" },
  needs_you: { text: "text-warn", dot: "bg-warn" },
  review: { text: "text-ok", dot: "bg-ok" },
  backlog: { text: "text-muted", dot: "bg-muted" },
  done: { text: "text-faint", dot: "bg-faint" },
};

export interface BoardListProps {
  byColumn: Map<Column, Card[]>;
  // The row for one card: Board.tsx draws it, so the list holds no card details of its own.
  renderRow: (card: Card, column: Column) => React.ReactNode;
  onNew: () => void;
}

export default function BoardList({ byColumn, renderRow, onNew }: BoardListProps) {
  const groups = useMemo(() => listGroups(byColumn), [byColumn]);

  return (
    <main
      className="board-sheet list-sheet flex min-w-0 flex-1 flex-col overflow-y-auto p-3"
      onDoubleClick={(e) => {
        // Empty space (not on a row or control) opens New thread, like the board's sheet.
        if (!(e.target as HTMLElement).closest("[data-card-id], button, a, input, textarea, [contenteditable]")) onNew();
      }}
    >
      {groups.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted">No cards yet.</div>
      ) : (
        <div className="flex flex-col gap-5">
          {/* The sheet's header: the columns, named, and stuck to the top while you scroll. */}
          <div className="sticky top-0 z-20 border-b border-line bg-card/95 backdrop-blur">
            <div className={`${LIST_GRID} px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint`}>
              <span>Title</span>
              <span>Status</span>
              <span>Stage</span>
              <span>Tags</span>
              <span>Folder</span>
              <span className="text-right">Age</span>
              <span />
            </div>
          </div>
          {groups.map((group) => (
            <section key={group.column} className="flex flex-col">
              {/* The column's band: its name, its count and its colour, across the sheet's width. */}
              <h2 className={`sticky top-0 z-10 flex items-center gap-2 border-y border-line bg-card/95 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] backdrop-blur ${TONE[group.column].text}`}>
                <span className={`size-1.5 rounded-full ${TONE[group.column].dot}`} aria-hidden />
                {group.label}
                <span className="font-normal tabular-nums text-faint">{group.cards.length}</span>
              </h2>
              <div className="divide-y divide-line border-b border-line">
                {group.cards.map((card) => (
                  <div key={card.id}>{renderRow(card, group.column)}</div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
