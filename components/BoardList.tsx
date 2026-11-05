"use client";

// The list view: every card the board shows as one sheet — a slightly futuristic Google Sheet on a
// pane of frosted glass, so the theme's picture stays behind it without washing out the text. Grid
// lines run across and down, a numbered gutter counts the rows, and each header filters and sorts its
// column as you type (lib/list-sheet.ts). The Backlog band comes first, folded to start with, then the
// bands you act on; every band folds on a click, and a card folds open to its subagents and the cards it
// started (lib/list-tree.ts). The Backlog and Running bands end in a quick add you just type into
// (components/SheetQuickAdd.tsx). Start typing and it searches titles; Space then B or R goes to a quick add
// (lib/list-keys.ts). Backlog rows drag into order. The headers and the bands stay put while you scroll.
import { useMemo, useRef, useState } from "react";
import type { Card, Column } from "@/lib/types";
import { listGroups } from "@/lib/board-view";
import { BOARD_SHEET, filterCount } from "@/lib/list-sheet";
import { bandsToDraw, sheetGroups, type SheetRow as SheetRowData } from "@/lib/list-tree";
import { knownFolders } from "@/lib/list-actions";
import { cronBadge, cronRows } from "@/lib/list-crons";
import { useCrons } from "@/lib/use-crons";
import { useNow } from "@/lib/use-now";
import { FunnelGlyph, SheetHeader, type HeaderMenu } from "@aimhuge/sheet/client";
import { LIST_GRID } from "./list-grid";
import type { RowNest } from "./CardRowCells";
import SheetBand, { type BandArchive } from "./SheetBand";
import SheetQuickAdd from "./SheetQuickAdd";
import SheetRow from "./SheetRow";
import AgentRow from "./AgentRow";
import SheetCrons from "./SheetCrons";
import { useListSheet } from "./use-list-sheet";
import { useListKeys } from "./use-list-keys";
import { useSheetDrag } from "./use-sheet-drag";
import "./list-sheet.css";

export interface BoardListProps {
  byColumn: Map<Column, Card[]>;
  // The row for one card: Board.tsx draws it, so the list holds no card details of its own. The nest
  // places it in the sheet's tree.
  renderRow: (card: Card, column: Column, nest?: RowNest) => React.ReactNode;
  onNew: () => void;
  notify?: (err: unknown) => void;
  // Put a Backlog card above or below another (the board's own reorder).
  onReorder?: (id: string, target: string, before: boolean) => void;
  // Show or hide archived cards, from the Done band.
  archive?: BandArchive;
}

export default function BoardList({ byColumn, renderRow, onNew, notify, onReorder, archive }: BoardListProps) {
  const now = useNow();
  const sheet = useListSheet();
  const crons = useCrons();
  // The cards opened up to show what's under them; they start folded.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const base = useMemo(() => listGroups(byColumn), [byColumn]);
  const all = useMemo(() => base.flatMap((g) => g.cards), [base]);
  const folders = useMemo(() => knownFolders(all), [all]);
  // The band whose + was clicked last, so its quick add takes the cursor (a fresh key each click).
  const [adding, setAdding] = useState<{ column: "backlog" | "running"; at: number } | null>(null);
  const { groups, shown, total } = useMemo(() => sheetGroups(base, sheet.state, expanded, now), [base, sheet.state, expanded, now]);
  const filters = filterCount(sheet.state.hidden, sheet.state.query);
  const [menu, setMenu] = useState<HeaderMenu>(null);
  const glass = useRef<HTMLDivElement>(null);
  const drag = useSheetDrag(onReorder);
  // Unfolds a band if need be and puts the cursor in its quick add.
  const addTo = (column: "backlog" | "running") => {
    if (sheet.state.collapsed.includes(column)) sheet.toggleBand(column);
    setAdding((cur) => ({ column, at: (cur?.at ?? 0) + 1 }));
  };
  const leader = useListKeys({
    onAdd: addTo,
    // A typed letter starts the title search afresh, in the Title header's menu.
    onSearch: (text) => {
      sheet.setQuery(text);
      const cell = glass.current?.querySelector('[data-head="title"]');
      if (cell) setMenu({ key: "title", anchor: cell.getBoundingClientRect() });
    },
  });
  const toggle = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const drawRow = (row: SheetRowData) =>
    row.kind === "agent" ? (
      <SheetRow key={`${row.parent.id}:${row.task.id}`}>
        <AgentRow task={row.task} depth={row.depth} now={now} />
      </SheetRow>
    ) : (
      <SheetRow
        key={`${row.card.id}:${row.depth}`}
        className={`${row.depth ? "sheet-row-nested" : ""} ${drag.dropClass(row.card.id)}`}
        gutter={row.number}
        {...drag.rowProps(row.card.id, row.column === "backlog" && row.depth === 0 && !sheet.state.sort)}
      >
        {renderRow(row.card, row.column, { depth: row.depth, kids: row.kids, expanded: row.expanded, onToggle: () => toggle(row.card.id), cron: cronBadge(row.card, crons.crons, now) })}
      </SheetRow>
    );

  return (
    <main
      className="board-sheet list-sheet relative flex min-w-0 flex-1 flex-col overflow-hidden p-3"
      onDoubleClick={(e) => {
        // Empty space (not on a row or control) opens New thread, like the board's sheet.
        if (!(e.target as HTMLElement).closest("[data-card-id], [data-agent-row], button, a, input, label, textarea, [contenteditable]")) onNew();
      }}
    >
      <div ref={glass} className="sheet-glass flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* The sheet's header: the corner, then the columns, stuck to the top while you scroll. */}
        <div className="sheet-head-row sticky top-0 z-20 flex">
          <span className="sheet-gutter sheet-corner">
            {filters > 0 && (
              <button
                onClick={sheet.clearFilters}
                title={`Showing ${shown} of ${total}. Clear ${filters === 1 ? "the filter" : `${filters} filters`}`}
                aria-label="Clear filters"
                className="flex items-center gap-0.5 rounded px-1 text-accent hover:bg-sunken"
              >
                <FunnelGlyph />×
              </button>
            )}
            {filters === 0 && (
              <button onClick={onNew} title="New thread, with every option" aria-label="New thread" className="sheet-corner-new">
                +
              </button>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <SheetHeader spec={BOARD_SHEET} grid={LIST_GRID} state={sheet.state} rows={all} shown={shown} now={now} actions={sheet} menu={menu} setMenu={setMenu} trailing={1} />
          </div>
        </div>
        {bandsToDraw(groups, sheet.state.collapsed, Boolean(archive?.count)).map((group) => {
          const addable = group.column === "backlog" || group.column === "running" ? group.column : null;
          return (
            <section key={group.column} className="flex flex-col">
              <SheetBand
                group={group}
                onFold={() => sheet.toggleBand(group.column)}
                onAdd={addable ? () => addTo(addable) : undefined}
                archive={group.column === "done" ? archive : undefined}
              />
              {group.rows.map(drawRow)}
              {addable && !group.collapsed && (
                <SheetQuickAdd
                  key={adding?.column === addable ? adding.at : addable}
                  column={addable}
                  folders={folders}
                  focus={adding?.column === addable}
                  onMore={onNew}
                  notify={notify}
                />
              )}
            </section>
          );
        })}
        <SheetCrons
          rows={cronRows(crons.crons, all, sheet.state.query)}
          collapsed={sheet.state.collapsed.includes("crons")}
          onFold={() => sheet.toggleBand("crons")}
          now={now}
          crons={crons}
          renderRow={renderRow}
          notify={notify}
        />
        {filters > 0 && shown === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-[13px] text-muted">
            No cards match these filters.
            <button onClick={sheet.clearFilters} className="text-accent hover:underline">
              Clear filters
            </button>
          </div>
        )}
      </div>
      {leader && (
        <div className="sheet-leader" role="status">
          Space · <kbd>B</kbd> Backlog · <kbd>R</kbd> Running · any other key runs its shortcut
        </div>
      )}
    </main>
  );
}
