"use client";

import { useSyncExternalStore } from "react";
import { subscribeBoardPrefs } from "./board-prefs";
import { simplePieceOn, type SimplePiece } from "./simple-mode";

// Whether one of simple mode's pieces is on (lib/simple-mode.ts), live: it follows Settings and the mode.
export function useSimplePiece(piece: SimplePiece): boolean {
  return useSyncExternalStore(subscribeBoardPrefs, () => simplePieceOn(piece), () => false);
}
