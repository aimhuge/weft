"use client";

import { useState } from "react";
import { useSimplePiece } from "./use-simple-piece";

// Simple mode's one-box New thread dialog (docs/architecture/simple-mode.md #3): with the piece on, the dialog is laid
// out like the phone's new-card screen (components/NewCardOneBox.tsx, lib/one-box.ts): project chips when it wasn't
// opened on a project, the where and model pills over the composer, and the thread starts with the picks the dialog
// already made. full is false then; showAll() (its More link) brings every control back for this dialog only. The
// state lives in the dialog, so closing it forgets that.
export function useOneBox(): { full: boolean; showAll: () => void } {
  const oneBox = useSimplePiece("one-box-new-card");
  const [more, setMore] = useState(false);
  return { full: !oneBox || more, showAll: () => setMore(true) };
}
