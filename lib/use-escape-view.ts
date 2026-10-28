"use client";

import { isTyping } from "./hotkeys";
import { railPinned } from "./rail-view";
import { useEscape } from "./use-escape";
import type { ViewMode } from "./board-prefs";

// What's open on the board that Escape closes before it flips the view.
export type BoardLayers = { thread: boolean; newThread: boolean; browser: boolean; drawer: boolean };

// True when nothing on the board is left for Escape to close. A pinned rail drawer stays put on Escape,
// so it doesn't count.
export function bareBoard({ thread, newThread, browser, drawer }: BoardLayers) {
  return !thread && !newThread && !browser && !(drawer && !railPinned());
}

// Escape on a bare board flips between board and list view. It is the bottom layer: it's off while a
// thread, the new-thread dialog, the browser or a closable drawer is up, so Escape closes those first,
// and dialogs and menus sit above every panel anyway. Escape typed in a field (the search box, a
// composer, the terminal's textarea) leaves the view alone.
//
// `onFlip` hears the view it switched to, so the board can pop a little pane saying where Escape
// just took you (lib/use-view-hint.ts). It never fires without a flip.
export function useEscapeTogglesView(
  open: BoardLayers,
  mode: ViewMode,
  choose: (next: ViewMode) => void,
  onFlip?: (next: ViewMode) => void,
) {
  useEscape(
    bareBoard(open),
    (e) => {
      if (isTyping(e.target)) return;
      const next = mode === "board" ? "list" : "board";
      choose(next);
      onFlip?.(next);
    },
    { panel: true },
  );
}
