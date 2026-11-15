"use client";

import type { ViewMode } from "./board-prefs";
import { useSimplePiece } from "./use-simple-piece";

// How the board draws its cards: simple mode's three piles turn the columns into a sidebar list
// (components/BoardSidebar.tsx); with the piece off, or in the list view, the user's own view stays.
export function useSurfaceMode(mode: ViewMode): ViewMode | "sidebar" {
  const piles = useSimplePiece("three-piles");
  return piles && mode === "board" ? "sidebar" : mode;
}

