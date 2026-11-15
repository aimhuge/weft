"use client";

// The board's middle: the columns, or the list of every card — whichever the user picked. It keeps
// the choice (and the two views' props) in one place, so Board.tsx only hands over state.
import type { ReactNode } from "react";
import type { Card, Column } from "@/lib/types";
import type { ViewMode } from "@/lib/board-prefs";
import type { ReviewFilter, ReviewFilterKey } from "@/lib/board-view";
import type { BoardColumnsProps } from "./BoardColumns";
import BoardColumns from "./BoardColumns";
import BoardList from "./BoardList";
import type { RowNest } from "./CardRowCells";

export interface BoardSurfaceProps extends Omit<BoardColumnsProps, "renderCard" | "drag" | "archive" | "review"> {
  // "sidebar" is simple mode's: the cards are in components/BoardSidebar.tsx and this is the space beside it.
  mode: ViewMode | "sidebar";
  // The card, as the board draws it; the list draws a row of its own.
  renderCard: (card: Card) => ReactNode;
  renderRow: (card: Card, column: Column, nest?: RowNest) => ReactNode;
  // The state the columns' extras are built from, so Board.tsx only hands over facts.
  drag: {
    over: Column | null;
    setOver: (column: Column | null) => void;
    onDrop: (column: Column, e: React.DragEvent) => void;
    onReorder: (id: string, target: string, before: boolean) => void;
  };
  archive: {
    count: number;
    shown: boolean;
    onToggleShown: () => void;
    done: Card[];
    tip: string;
    cards: (list: Card[]) => void;
    restore: (ids: string[]) => void;
  };
  review: {
    resumeAll?: { count: number; run: () => void };
    onReviewAll: () => Promise<void>;
    filter: ReviewFilter;
    toggleFilter: (key: ReviewFilterKey) => void;
  };
}

// The drag bundle the columns expect, built from the board's drag state.
function dragBundle(drag: BoardSurfaceProps["drag"]): BoardColumnsProps["drag"] {
  return {
    over: drag.over,
    onOver: drag.setOver,
    onLeave: (column) => drag.setOver(drag.over === column ? null : drag.over),
    onDrop: drag.onDrop,
    onReorder: drag.onReorder,
  };
}

export default function BoardSurface({ mode, renderRow, drag, archive, review, ...props }: BoardSurfaceProps) {
  if (mode === "sidebar") {
    // The rest of the window beside the sidebar: the open card's frame covers it, or the board's pane sits in it.
    // It keeps .board-sheet so the empty board's start panel (components/EmptyBoardStart.tsx) centers here.
    return <main data-board-surface className="board-sheet min-w-0 flex-1" onDoubleClick={props.onNew} />;
  }
  if (mode === "list") {
    return <BoardList byColumn={props.byColumn} renderRow={renderRow} onNew={props.onNew} notify={props.notify} onReorder={drag.onReorder} archive={{ count: archive.count, shown: archive.shown, onToggle: archive.onToggleShown }} />;
  }
  return <BoardColumns {...props} drag={dragBundle(drag)} archive={archive} review={review} />;
}
