"use client";

// A list-view row's status cell: what the thread is doing, and, on a click or a right-click, a menu of what
// it can do right now (lib/list-actions.ts): stop it, run it, carry it on, or park it.
import { useState } from "react";
import { rowStatus } from "@/lib/list-sheet";
import { statusActions, type StatusAction } from "@/lib/list-actions";
import { COLUMN_TONE } from "@/lib/column-tone";
import type { Card, Column } from "@/lib/types";
import Icon, { Spinner } from "./Icon";
import { SheetPopover } from "@aimhuge/sheet/client";
import { Chevron } from "./CardRowCells";

export default function RowStatusCell({ card, column, onAction }: { card: Card; column: Column; onAction: (action: StatusAction) => void }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const status = rowStatus(card);
  const open = (e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setAnchor(e.currentTarget.getBoundingClientRect());
  };
  return (
    <span className="sheet-status-cell group/status min-w-0 text-[11px]">
      <button
        onClick={open}
        onContextMenu={open}
        aria-haspopup="menu"
        aria-label={`${status?.word ?? "Status"}: what this card can do`}
        title={status?.tip ?? "Stop, run or move this card"}
        className={`flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-left ${status?.tone ?? COLUMN_TONE[column].text}`}
      >
        {status && (status.spinner ? <Spinner size={10} /> : <Icon name={status.icon} size={11} />)}
        <span className="truncate">{status?.word ?? ""}</span>
        <span className="ml-auto rotate-90 text-faint opacity-0 group-hover/status:opacity-100" aria-hidden>
          <Chevron open={false} />
        </span>
      </button>
      {anchor && (
        <SheetPopover anchor={anchor} width={220} label={`${card.title}: actions`} onClose={() => setAnchor(null)}>
          <div role="menu" className="flex flex-col p-1">
            {statusActions(card, column).map((item) => (
              <button
                key={item.id}
                role="menuitem"
                onClick={() => {
                  setAnchor(null);
                  onAction(item.id);
                }}
                className={`flex flex-col rounded-md px-2.5 py-1.5 text-left hover:bg-sunken ${item.danger ? "text-danger" : ""}`}
              >
                <span className="text-[12px] font-medium">{item.label}</span>
                {item.hint && <span className="text-[10.5px] text-faint">{item.hint}</span>}
              </button>
            ))}
          </div>
        </SheetPopover>
      )}
    </span>
  );
}
