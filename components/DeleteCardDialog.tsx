"use client";

// The delete-card confirmation. A native confirm (window.confirm) can't show a checkbox, so this
// small modal does — the same shape as the Switch all dialog (components/switch-all-button.tsx).
//
// The user can tick "Don't ask again": the next delete goes straight through, and the flag lives
// in localStorage (lib/delete-confirm.ts). Ticking it and then deleting is what turns it off, so
// cancelling leaves the preference alone.
import { useState } from "react";
import { rememberDeleteConfirm } from "@/lib/delete-confirm";
import { isLive } from "@/lib/format";
import type { Card } from "@/lib/types";
import Icon from "./Icon";
import Modal from "./Modal";

export interface DeleteCardDialogProps {
  title: string;
  // The card is running its first turn: deleting stops it.
  live?: boolean;
  onCancel: () => void;
  // The dialog writes the "don't ask again" preference itself, so this only says "delete it".
  onConfirm: () => void;
}

export default function DeleteCardDialog({ title, live, onCancel, onConfirm }: DeleteCardDialogProps) {
  const [dontAskAgain, setDontAskAgain] = useState(false);

  const confirm = () => {
    if (dontAskAgain) rememberDeleteConfirm(true);
    onConfirm();
  };

  return (
    <Modal title="Delete card" onClose={onCancel}>
      <div className="px-4 pb-4 pt-3 text-[13px] text-ink">
        <p className="flex items-start gap-2">
          <Icon name="trash" size={15} className="mt-0.5 shrink-0 text-danger" />
          <span>
            Delete <span className="font-medium">“{title}”</span>?
            {live && " This stops its turn."}
            {" "}Its CLI transcript stays on disk.
          </span>
        </p>
        <label className="mt-3 flex items-center gap-2 text-faint">
          <input type="checkbox" checked={dontAskAgain} onChange={(e) => setDontAskAgain(e.target.checked)} />
          Don&apos;t ask again
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-line-strong px-3 py-1.5 text-[12.5px] hover:bg-sunken"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            className="rounded-md bg-danger px-3 py-1.5 text-[12.5px] font-medium text-white hover:opacity-90"
          >
            Delete
          </button>
        </div>
      </div>
    </Modal>
  );
}

// The board's right-click menu's Delete: it holds the card waiting to be deleted and draws the
// confirmation over the board. A .ts file can't hold JSX, so the menu hook (components/use-board-menus.ts)
// returns this node instead of the markup.
export function BoardDeleteDialog({ card, onCancel, onConfirm }: {
  card: Card;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <DeleteCardDialog
      title={card.title}
      // The card is running its first turn: deleting stops it, so the dialog says so.
      live={isLive(card)}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
