"use client";

// The board's delete-card confirmation, as a hook of its own.
//
// It lives here rather than inside components/use-board-menus.ts because the board's own file map
// says: when a file hits its size cap, name the smell and move the code out. Board.tsx draws the
// dialog, so it needs the node, but the state behind it (which card is waiting to be deleted, and
// whether the user wants to be asked at all) belongs with the rest of the logic.
//
// The dialog is Weft's own modal (components/DeleteCardDialog.tsx): a native confirm can't show a
// checkbox, so the "Don't ask again" tick lives in the modal and its flag in lib/delete-confirm.ts.
import { createElement, useState } from "react";
import { removeNow } from "@/lib/optimistic-cards";
import { shouldConfirmDelete } from "@/lib/delete-confirm";
import type { Card } from "@/lib/types";
import { BoardDeleteDialog } from "@/components/DeleteCardDialog";

export interface UseDeleteDialog {
  // The card waiting to be deleted, or null when no confirmation is open.
  deleting: Card | null;
  // The node the board draws over its columns, already built (null when nothing is open).
  dialog: React.ReactNode;
  // Call this instead of deleting straight away: it asks first, unless the user said not to be.
  ask: (card: Card) => void;
  // Delete the card now, skipping the confirmation.
  remove: (card: Card) => void;
}

// The board's delete: it clears the open card if it was the one going, then tells the server.
// The confirmation is the only thing in front of it (lib/delete-confirm.ts).
export function removeCard(card: Card, isOpen: (card: Card) => boolean, select: (id: string | null) => void, notify: (err: unknown) => void) {
  if (isOpen(card)) select(null);
  removeNow(card.id).catch(notify);
}

// The delete confirmation the board draws. `remove` is what actually deletes: the menu's Delete
// item calls `ask`, and the dialog's Delete button calls `remove` with the card it was opened for.
export function useDeleteDialog(remove: (card: Card) => void): UseDeleteDialog {
  const [deleting, setDeleting] = useState<Card | null>(null);

  const ask = (card: Card) => {
    // Asks first, unless the user ticked "Don't ask again" (lib/delete-confirm.ts).
    if (!shouldConfirmDelete()) remove(card);
    else setDeleting(card);
  };

  return {
    deleting,
    dialog: deleting
      ? createElement(BoardDeleteDialog, {
          card: deleting,
          onCancel: () => setDeleting(null),
          onConfirm: () => {
            const card = deleting;
            setDeleting(null);
            remove(card);
          },
        })
      : null,
    ask,
    remove,
  };
}
