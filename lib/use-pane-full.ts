"use client";

import type { ColumnId } from "./workspace-layout";
import { useRailOpen, useThreadShown } from "./pane-rail-open";
import { useSimplePiece } from "./use-simple-piece";

// Simple mode's full-page pane for the open card (docs/architecture/simple-mode.md, piece 1). It applies on this Mac's
// own pane while its column is open. The show column folds into a pill (rail: whether it's opened inside the pane), and
// like the phone the pane is the app: the thread column hides until the live line opens it (thread).
export function usePaneFull(canPane: boolean, paneOpen: boolean) {
  const pieceOn = useSimplePiece("pane-full");
  const railOpen = useRailOpen();
  const thread = useThreadShown();
  const full = pieceOn && canPane && paneOpen;
  const hidden: ColumnId[] | undefined = full ? (thread ? ["show"] : ["show", "thread"]) : undefined;
  return { full, rail: full && railOpen, thread, hidden };
}
