"use client";

// One card in the list view: a row of the sheet, with a cell per column — its title, what it is
// doing, its stage, its tags, its folder and its age — so the columns line up down the list. A row
// in the sheet's tree (lib/list-tree.ts) is indented and folds open to what's under it; its status
// opens a menu of what it can do, and its folder a picker to move it.
import type { Card, Column } from "@/lib/types";
import { activeAt } from "@/lib/board-view";
import type { ResumeHow } from "@/lib/card-resume";
import type { StatusAction } from "@/lib/list-actions";
import { LIST_GRID } from "./list-grid";
import { ActionsCell, AgeCell, StageCell, TagsCell, TitleCell, type RowNest } from "./CardRowCells";
import RowStatusCell from "./RowStatusCell";
import RowFolderCell from "./RowFolderCell";

export type { RowNest } from "./CardRowCells";

export interface CardRowProps {
  card: Card;
  // Where the card sits, which can differ from the card's own column while it wraps up.
  column: Column;
  now: number;
  selected: boolean;
  lastOpen?: boolean;
  unseen?: boolean;
  nest?: RowNest;
  onOpen: () => void;
  onStop?: () => void;
  onResume?: (how: ResumeHow) => void;
  // Move it to another column: Run now is a move from the Backlog to Running.
  onMove?: (column: Column) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onStar?: () => void;
  onTag?: (tag: string) => void;
  onArchive?: () => void;
  alsoHere?: Card[];
  // The folders it can move to, and the move (components/RowFolderCell.tsx).
  folders?: string[];
  onFolder?: (cwd: string) => void;
}

// What the status menu's pick does, through the row's own handlers; one the row wasn't given does nothing.
function runAction(action: StatusAction, p: CardRowProps) {
  if (action === "open") p.onOpen();
  else if (action === "stop") p.onStop?.();
  else if (action === "run") p.onMove?.("running");
  else if (action === "continue" || action === "restart") p.onResume?.(action);
  else p.onMove?.(action.slice(5) as Column);
}

export default function CardRow(props: CardRowProps) {
  const { card, column, now, selected, lastOpen = false, unseen = false, nest, alsoHere = [] } = props;
  return (
    <div
      role="button"
      tabIndex={0}
      data-card-id={card.id}
      data-list-row
      onClick={props.onOpen}
      onContextMenu={props.onContextMenu}
      className={`group relative flex items-stretch transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${rowTint(selected, lastOpen, unseen)}`}
    >
      {/* The selected cell's edge, like the selection in a grid. */}
      {selected && <span className="absolute inset-y-0 left-0 w-[2px] bg-accent shadow-[0_0_8px_var(--color-accent)]" aria-hidden />}

      <div className={`${LIST_GRID} w-full`}>
        <TitleCell card={card} unseen={unseen} nest={nest} />
        <RowStatusCell card={card} column={column} onAction={(action) => runAction(action, props)} />
        <StageCell card={card} column={column} />
        <TagsCell card={card} onTag={props.onTag} />
        <RowFolderCell card={card} alsoHere={alsoHere} folders={props.folders} onFolder={props.onFolder} />
        <AgeCell at={activeAt(card)} now={now} />
        <ActionsCell card={card} onStop={props.onStop} onResume={props.onResume} onStar={props.onStar} onArchive={props.onArchive} />
      </div>
    </div>
  );
}

// The row's background: the card you picked is lit, the one you opened last is dimmed, a new one
// glows a little, and the rest light up under the pointer.
function rowTint(selected: boolean, lastOpen: boolean, unseen: boolean) {
  if (selected) return "bg-accent-soft";
  if (lastOpen) return "bg-sunken";
  if (unseen) return "bg-accent-soft/40";
  return "hover:bg-sunken";
}
