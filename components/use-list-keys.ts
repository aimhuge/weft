"use client";

// The board's list view's keyboard (lib/list-keys.ts) on @aimhuge/sheet's listener: type to search titles, Space then
// B or R for a quick add. Returns whether Space is waiting for its second key.
import { LIST_KEYS } from "@/lib/list-keys";
import { useSheetKeys } from "@aimhuge/sheet/client";

export interface ListKeyHandlers {
  onSearch: (text: string) => void;
  onAdd: (column: "backlog" | "running") => void;
}

// Something open over the board: a dialog, a menu, or a thread (its panel's close button).
function blocked() {
  return Boolean(document.querySelector('[role="dialog"], [aria-label="Close thread"]'));
}

export function useListKeys({ onSearch, onAdd }: ListKeyHandlers) {
  return useSheetKeys({ ...LIST_KEYS, onSearch, onLead: onAdd, blocked });
}
