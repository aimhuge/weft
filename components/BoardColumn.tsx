"use client";

// One column on the board: the header (with column-specific actions), a scrollable list of cards,
// a "Show more" button when the column is collapsed, and the placeholder / add-thread button.
// CardView is loaded through guarded() in Board.tsx and rendered via the `renderCard` prop so this
// file does not have to know the lazy-load wrapper.
import { useState } from "react";
import type { CSSProperties, DragEvent, MouseEvent, ReactNode } from "react";
import type { Card, Column } from "@/lib/types";
import type { LaneState } from "@/lib/copilot-lane";
import { columnMinWidth } from "@/lib/copilot-lane";
import { busyHere } from "@/lib/overlap";
import type { BacklogLane } from "./BacklogActions";
import type { ReviewChips } from "./ReviewFilterChips";
import Icon from "./Icon";
import ColumnHeader from "./ColumnHeader";
import ColumnPlaceholder from "./ColumnPlaceholder";

// Cards shown per column until "Show more"; picking up Claude Code sessions can put hundreds in one.
export const COLUMN_LIMIT = 40;

export interface BoardColumnProps {
  column: { id: Column; label: string };
  shown: readonly Card[];
  count: number;
  loaded: boolean;
  filtering: boolean;
  // Per-column visual state.
  dragOver: boolean;
  laneState: LaneState;
  // "Show N more" button: called with the column id so Board can track which columns are expanded.
  onShowMore: () => void;
  // Renders one card row (Board.tsx owns the lazy-loaded CardView component).
  renderCard: (card: Card) => ReactNode;
  // Column actions.
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
  onColumnContextMenu: (e: MouseEvent) => void;
  // Backlog-only: a card dropped on a sibling calls this with the moved id, the target id, and
  // whether the drop was on the top half (place before) or bottom half (place after). target is
  // the card it landed on, and `before` is true when the drop indicator was on its top
  // half (place before) and false when it was on the bottom half (place after).
  onReorder?: (id: string, target: string, before: boolean) => void;
  // Column header props.
  needsYou: boolean;
  archivedCount: number;
  showArchived: boolean;
  onToggleArchived: () => void;
  toArchive: number;
  archiveTip: string;
  onArchiveAll: () => void;
  resumeAll?: { count: number; run: () => void };
  onSwitchAll?: () => void | Promise<void>;
  onReviewAll?: () => Promise<void>;
  onAddBacklog: () => void;
  // Backlog only: its sprints, Save as sprint and Archive all.
  backlog?: BacklogLane;
  // Review only: its Errors and Restart filter chips.
  reviewFilter?: ReviewChips;
  // The header's chevron, which folds the column to a strip (components/FoldedColumn.tsx).
  onFold?: () => void;
  // Two columns' width with its cards in two columns, when the board has room (lib/board-overflow.ts).
  wide?: boolean;
}

export default function BoardColumn({
  column,
  shown,
  count,
  loaded,
  filtering,
  dragOver,
  laneState,
  onShowMore,
  renderCard,
  onDragOver,
  onDragLeave,
  onDrop,
  onColumnContextMenu,
  onReorder,
  needsYou,
  archivedCount,
  showArchived,
  onToggleArchived,
  toArchive,
  archiveTip,
  onArchiveAll,
  resumeAll,
  onSwitchAll,
  onReviewAll,
  onAddBacklog,
  backlog,
  reviewFilter,
  onFold,
  wide = false,
}: BoardColumnProps) {
  const style: CSSProperties = { minWidth: columnMinWidth(laneState) };
  // Which backlog card the drop indicator is on, and on which side. null when no card is hovered.
  const [dropMarker, setDropMarker] = useState<{ id: string; before: boolean } | null>(null);
  return (
    <section
      data-column={column.id}
      onDragOver={onDragOver}
      onDragLeave={() => {
        onDragLeave();
        setDropMarker(null);
      }}
      onDrop={(e) => {
        onDrop(e);
        setDropMarker(null);
      }}
      onContextMenu={onColumnContextMenu}
      style={style}
      className={`@container flex ${wide ? "w-[540px]" : "w-[264px]"} shrink flex-col rounded-xl border ${dragOver ? "border-accent bg-accent-soft" : "border-transparent bg-sunken"}`}
    >
      <ColumnHeader
        column={column}
        count={loaded ? count : null}
        needsYou={needsYou}
        archivedCount={archivedCount}
        showArchived={showArchived}
        onToggleArchived={onToggleArchived}
        toArchive={toArchive}
        archiveTip={archiveTip}
        onArchiveAll={onArchiveAll}
        resumeAll={resumeAll}
        onSwitchAll={onSwitchAll}
        onReviewAll={onReviewAll}
        backlog={backlog}
        reviewFilter={reviewFilter}
        onFold={onFold}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        <CardList wide={wide}>
          {shown.map((card) => (
            <CardDropSlot
              key={card.id}
              card={card}
              reorderable={Boolean(onReorder)}
              marker={dropMarker?.id === card.id ? dropMarker.before : null}
              onMarkerChange={(before) => setDropMarker(before === null ? null : { id: card.id, before })}
              onReorder={(id, before) => onReorder?.(id, card.id, before)}
            >
              {renderCard(card)}
            </CardDropSlot>
          ))}
        </CardList>
        {shown.length < count && (
          <button
            onClick={onShowMore}
            className="rounded-lg px-2 py-1.5 text-center text-[12px] text-muted hover:bg-card hover:text-ink"
          >
            Show {count - shown.length} more
          </button>
        )}
        <ColumnPlaceholder column={column.id} loaded={loaded} empty={count === 0} filtering={filtering} />
        {column.id === "backlog" && (
          <button
            onClick={onAddBacklog}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-muted hover:bg-card hover:text-ink"
          >
            <Icon name="plus" size={13} /> Add a thread
          </button>
        )}
      </div>
    </section>
  );
}

// The column's cards: one under another, or in two columns side by side in a wide column (left to right,
// then down, so Backlog's order still reads top first). A narrow column's cards sit straight in its list.
function CardList({ wide, children }: { wide: boolean; children: ReactNode }) {
  if (!wide) return <>{children}</>;
  return <div className="grid grid-cols-2 items-start gap-2">{children}</div>;
}

// What a card draws while CardView's module loads: a card-sized blank, so the column keeps its
// height and "Show N more" stays below the cards instead of floating up and then jumping away.
export function CardSkeleton() {
  return <div aria-hidden className="h-[72px] shrink-0 rounded-lg border border-line bg-card opacity-60" />;
}

// Re-export the helper for callers that still want to compute "is this card overlapping?"
export { busyHere };

// Wraps a card in a drop target when reordering is on. The drop indicator is a 1-pixel-thick
// accent line on the top or bottom edge of the hovered card; whichever half the cursor enters
// decides before vs. after. Drops on the same card the user picked up are ignored — that's a
// no-op reorder, not a move.
function CardDropSlot({
  card,
  reorderable,
  marker,
  onMarkerChange,
  onReorder,
  children,
}: {
  card: Card;
  reorderable: boolean;
  // null when no marker, true when on the top half (place before), false when on the bottom.
  marker: boolean | null;
  onMarkerChange: (before: boolean | null) => void;
  onReorder: (id: string, before: boolean) => void;
  children: ReactNode;
}) {
  if (!reorderable) return <>{children}</>;
  return (
    <div
      data-drop-slot={card.id}
      onDragOver={(e) => {
        // Only react to drags that carry a card id; ignore file drops, text, etc.
        const types = e.dataTransfer.types;
        if (!types.includes("text/plain")) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        const before = e.clientY - rect.top < rect.height / 2;
        if (marker !== before) onMarkerChange(before);
      }}
      onDragLeave={(e) => {
        // Only clear when the cursor leaves this slot for something other than a child. relatedTarget
        // is the element the cursor entered; if it's still inside this slot, keep the marker.
        const next = e.relatedTarget as Node | null;
        if (next && e.currentTarget.contains(next)) return;
        onMarkerChange(null);
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData("text/plain");
        if (!id || id === card.id) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        const before = e.clientY - rect.top < rect.height / 2;
        onReorder(id, before);
        onMarkerChange(null);
      }}
      className="relative"
    >
      {marker !== null && (
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full bg-accent ${marker ? "top-0" : "bottom-0"}`}
        />
      )}
      {children}
    </div>
  );
}
