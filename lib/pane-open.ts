"use client";

// Where an open card's panel puts a page (the review tour's steps, its app): this Mac's native pane, or, for a card
// whose host has none (a worker's), the open card's own pane column, which OpenCard provides here from
// lib/use-project-host.ts `page.open`. The opener is stable per card, so an effect that opens a step's page runs once
// per page, not on every render of a provider that hands down a new closure.
import { createContext, useCallback, useContext, useEffect, useRef } from "react";

export const PaneOpenContext = createContext<((url: string) => void) | undefined>(undefined);

// Opens `url`, or with none shows the pane as it is (the native pane only: a card's own pane column is already there).
export function usePaneOpen(cardId: string): (url?: string) => void {
  const open = useContext(PaneOpenContext);
  const latest = useRef(open);
  useEffect(() => {
    latest.current = open;
  });
  return useCallback(
    (url?: string) => {
      const column = latest.current;
      if (column) {
        if (url) column(url);
        return;
      }
      if (url) window.weft?.browser.open(url, cardId).catch(() => {});
      else window.weft?.browser.setVisible(true);
    },
    [cardId],
  );
}
