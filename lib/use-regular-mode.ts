"use client";

import { useSyncExternalStore } from "react";
import { boardMode, subscribeBoardPrefs } from "./board-prefs";

// Whether the board is in Regular mode, with its chrome stripped off (lib/board-prefs.ts).
export function useRegularMode(): boolean {
  return useSyncExternalStore(subscribeBoardPrefs, boardMode, () => "advanced" as const) === "regular";
}
