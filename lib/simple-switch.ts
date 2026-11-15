"use client";

import { useEffect } from "react";
import { boardMode, setBoardMode } from "./board-prefs";
import type { ToastAction } from "./use-toast";

// The update that brought simple mode moves every existing board onto it once (docs/architecture/simple-mode.md):
// a board still on advanced switches to regular, which is simple mode, and a toast says so with a way back. A new
// install is already regular (WelcomeDialog), so it switches nothing and shows nothing. A cookie, like the other board
// prefs (lib/board-prefs.ts), marks it done so a later "Switch back" or Settings choice is never undone.
const DONE_COOKIE = "weft-simple-switched";

export const SIMPLE_SWITCH_TOAST = "Weft is now in Simple mode: your threads on the left, the open one beside them, one composer.";

// Switches this board once. True when it moved a board off advanced, so the caller says so.
export function switchToSimpleOnce(): boolean {
  if (new RegExp(`(?:^|; )${DONE_COOKIE}=1`).test(document.cookie)) return false;
  document.cookie = `${DONE_COOKIE}=1; path=/; max-age=${10 * 365 * 24 * 60 * 60}; SameSite=Lax`;
  if (boardMode() === "regular") return false;
  setBoardMode("regular");
  return true;
}

// Once the board's cards are on screen, the one-time switch and its toast, whose button puts advanced back.
export function useSimpleSwitch(loaded: boolean, toast: (text: string, action?: ToastAction) => void) {
  useEffect(() => {
    if (!loaded || !switchToSimpleOnce()) return;
    toast(SIMPLE_SWITCH_TOAST, { label: "Switch back", run: () => setBoardMode("advanced") });
  }, [loaded, toast]);
}
