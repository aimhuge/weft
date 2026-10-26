"use client";

// Drag a Backlog row above or below another to put it in that order, as the board's Backlog column does
// (lib/use-board-card-actions.ts reorder, which saves the order). The row being dragged dims and a line shows where
// it lands. Only top-level Backlog rows drag, and only with the sheet unsorted: a sort would put them right back.
import { useState } from "react";

type Drag = { id: string; over?: string; before?: boolean } | null;

export function useSheetDrag(onReorder?: (id: string, target: string, before: boolean) => void) {
  const [drag, setDrag] = useState<Drag>(null);

  const rowProps = (id: string, on: boolean): React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean } => {
    if (!on || !onReorder) return {};
    return {
      draggable: true,
      onDragStart: (e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
        setDrag({ id });
      },
      onDragOver: (e) => {
        if (!drag || drag.id === id) return;
        e.preventDefault();
        const box = e.currentTarget.getBoundingClientRect();
        const before = e.clientY < box.top + box.height / 2;
        if (drag.over !== id || drag.before !== before) setDrag({ ...drag, over: id, before });
      },
      onDrop: (e) => {
        e.preventDefault();
        if (drag && drag.id !== id && drag.over === id) onReorder(drag.id, id, drag.before ?? true);
        setDrag(null);
      },
      onDragEnd: () => setDrag(null),
    };
  };

  // The row's look while a drag is on: dimmed if it's the one moving, a line on the side it would land.
  const dropClass = (id: string) => {
    if (drag?.id === id) return "sheet-dragging";
    if (drag?.over !== id) return "";
    return drag.before ? "sheet-drop-before" : "sheet-drop-after";
  };

  return { rowProps, dropClass };
}
