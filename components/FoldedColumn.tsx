"use client";

// A folded column: a thin strip with the column's name and count, set on its side, in place of the
// whole column. Clicking it opens the column again; a card dropped on it still lands in that column.
// Backlog folds this way (its header's chevron, lib/board-prefs.ts `backlogFolded`).
import type { DragEvent } from "react";
import type { Column } from "@/lib/types";
import Icon from "./Icon";

export default function FoldedColumn({
  column,
  count,
  dragOver,
  onUnfold,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  column: { id: Column; label: string };
  count: number | null;
  dragOver: boolean;
  onUnfold: () => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
}) {
  return (
    <section
      data-column={column.id}
      data-folded
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`flex w-8 shrink-0 flex-col rounded-xl border ${dragOver ? "border-accent bg-accent-soft" : "border-transparent bg-sunken"}`}
    >
      <button
        onClick={onUnfold}
        aria-label={`Open ${column.label}`}
        title={`Open ${column.label}`}
        className="flex flex-1 flex-col items-center gap-2 rounded-xl pt-2.5 text-muted hover:bg-hover hover:text-ink"
      >
        <Icon name="chevronRight" size={13} />
        <span className="text-[12.5px] font-medium text-ink [writing-mode:vertical-rl]">{column.label}</span>
        {count !== null && <span className="text-[11.5px] text-faint">{count}</span>}
      </button>
    </section>
  );
}
