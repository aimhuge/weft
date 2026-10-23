"use client";

// The board's row of columns: the <main> sheet and one BoardColumn per visible column, with the
// column-specific extras (Backlog's sprints and reorder, Review's Resume all / Review all / filter
// chips, Running and Needs you's Switch all) wired by column id here so Board only passes state in.
import type { DragEvent, MouseEvent, ReactNode } from "react";
import type { Card, Column } from "@/lib/types";
import type { LaneState } from "@/lib/copilot-lane";
import { reviewFilterCounts, type ReviewFilter, type ReviewFilterKey } from "@/lib/board-view";
import BoardColumn, { COLUMN_LIMIT } from "./BoardColumn";

export interface BoardColumnsProps {
  columns: readonly { id: Column; label: string }[];
  byColumn: Map<Column, Card[]>;
  // Every card on the board, for what each of Backlog's saved sprints holds.
  allCards: readonly Card[];
  // Columns showing every card instead of the first COLUMN_LIMIT.
  expanded: readonly Column[];
  onExpand: (column: Column) => void;
  renderCard: (card: Card) => ReactNode;
  loaded: boolean;
  filtering: boolean;
  laneState: LaneState;
  // A card dragged over a column, dropped on one, or (Backlog only) dropped on a sibling to reorder.
  drag: {
    over: Column | null;
    onOver: (column: Column) => void;
    onLeave: (column: Column) => void;
    onDrop: (column: Column, e: DragEvent) => void;
    onReorder: (id: string, target: string, before: boolean) => void;
  };
  onColumnMenu: (column: Column, e: MouseEvent) => void;
  archive: {
    count: number;
    shown: boolean;
    onToggleShown: () => void;
    // Done's unarchived cards, for its Archive all.
    done: Card[];
    tip: string;
    cards: (list: Card[]) => void;
    restore: (ids: string[]) => void;
  };
  // Set only while a plan limit is hit: Running and Needs you offer to switch every card's CLI.
  onSwitchAll?: (column: Column) => void | Promise<void>;
  // Review's extras: Resume all (when any of its cards can be resumed), Review all, and its filter chips.
  review: {
    resumeAll?: { count: number; run: () => void };
    onReviewAll: () => Promise<void>;
    filter: ReviewFilter;
    toggleFilter: (key: ReviewFilterKey) => void;
  };
  // Double-clicking empty board space, or Backlog's add button.
  onNew: () => void;
  toast: (message: string) => void;
  notify: (err: unknown) => void;
}

export default function BoardColumns(props: BoardColumnsProps) {
  const { columns, byColumn, expanded, onNew } = props;
  return (
    <main
      className="board-sheet flex min-w-0 flex-1 gap-3 overflow-x-auto p-3"
      onDoubleClick={(e) => {
        // Empty board space (between or inside columns, not on a card or control) opens New thread.
        if (!(e.target as HTMLElement).closest("[data-card-id], button, a, input, textarea, [contenteditable]")) onNew();
      }}
    >
      {columns.map((column) => {
        const list = byColumn.get(column.id) ?? [];
        const shown = expanded.includes(column.id) ? list : list.slice(0, COLUMN_LIMIT);
        return <OneColumn key={column.id} {...props} column={column} list={list} shown={shown} />;
      })}
    </main>
  );
}

function OneColumn({ column, list, shown, ...p }: BoardColumnsProps & { column: { id: Column; label: string }; list: Card[]; shown: Card[] }) {
  const id = column.id;
  const count = list.length;
  const review = id === "review";
  const backlog = id === "backlog";
  const unarchived = () => list.filter((c) => !c.archived);
  return (
    <BoardColumn
      column={column}
      shown={shown}
      count={count}
      loaded={p.loaded}
      filtering={p.filtering}
      dragOver={p.drag.over === id}
      laneState={p.laneState}
      onShowMore={() => p.onExpand(id)}
      renderCard={p.renderCard}
      onDragOver={(e) => {
        e.preventDefault();
        p.drag.onOver(id);
      }}
      onDragLeave={() => p.drag.onLeave(id)}
      onDrop={(e) => p.drag.onDrop(id, e)}
      onReorder={backlog ? p.drag.onReorder : undefined}
      onColumnContextMenu={(e) => p.onColumnMenu(id, e)}
      needsYou={id === "needs_you" && count > 0}
      archivedCount={p.archive.count}
      showArchived={p.archive.shown}
      onToggleArchived={p.archive.onToggleShown}
      toArchive={p.archive.done.length}
      archiveTip={p.archive.tip}
      onArchiveAll={() => p.archive.cards(p.archive.done)}
      resumeAll={review ? p.review.resumeAll : undefined}
      onSwitchAll={p.onSwitchAll && (id === "running" || id === "needs_you") ? () => p.onSwitchAll?.(id) : undefined}
      onReviewAll={review ? p.review.onReviewAll : undefined}
      reviewFilter={review ? { on: p.review.filter, counts: reviewFilterCounts(list), toggle: p.review.toggleFilter } : undefined}
      onAddBacklog={p.onNew}
      // Backlog's sprints, Save as sprint and Archive all act on the unarchived cards it shows.
      backlog={backlog ? { cards: unarchived(), allCards: p.allCards, onRestore: p.archive.restore, toast: p.toast, notify: p.notify,
        onArchiveAll: () => p.archive.cards(unarchived()) } : undefined}
    />
  );
}
