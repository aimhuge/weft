"use client";

import { useCallback, useSyncExternalStore } from "react";
import { setViewMode, subscribeBoardPrefs, viewMode, type ViewMode } from "./board-prefs";
import { useRegularMode } from "./use-regular-mode";

// The board's layout: cards in columns (the default) or in one list of every card. It lives in a
// cookie (lib/board-prefs.ts), like the theme and the other board prefs, and the board redraws when
// it changes without a reload. Regular mode has no view toggle, so it's always the board, and a saved
// list view waits for Advanced.
export function useViewMode() {
  const saved = useSyncExternalStore<ViewMode>(subscribeBoardPrefs, viewMode, () => "board");
  const regular = useRegularMode();
  const choose = useCallback(
    (next: Parameters<typeof setViewMode>[0]) => {
      if (!regular) setViewMode(next);
    },
    [regular],
  );
  return { mode: regular ? ("board" as const) : saved, choose };
}
