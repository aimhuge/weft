"use client";

import { useCallback, useSyncExternalStore } from "react";
import { setViewMode, subscribeBoardPrefs, viewMode, type ViewMode } from "./board-prefs";

// The board's layout: cards in columns (the default) or in one list of every card. It lives in a
// cookie (lib/board-prefs.ts), like the theme and the other board prefs, and the board redraws when
// it changes without a reload.
export function useViewMode() {
  const mode = useSyncExternalStore<ViewMode>(subscribeBoardPrefs, viewMode, () => "board");
  const choose = useCallback((next: Parameters<typeof setViewMode>[0]) => setViewMode(next), []);
  return { mode, choose };
}
