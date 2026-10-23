"use client";

import { useEffect, type RefObject } from "react";
import { api } from "./client";

// The browser pane's page beside the New thread dialog (not a card's).
export const NEW_THREAD_PANE = "new-thread";

// While the New thread dialog is up, the browser pane beside it shows the splash. Closing it goes back to
// the open card's browser (a card just started is open by then), or the pane as it was.
export function useNewThreadPane(showNew: boolean, selectedRef: RefObject<string | null>) {
  useEffect(() => {
    const bridge = window.weft;
    if (!showNew || !bridge) return;
    const before = bridge.browser.getState();
    const page = api.newThreadPage();
    const shown = page.then(({ url }) => bridge.browser.open(url, NEW_THREAD_PANE)).catch(() => {});
    return () => {
      void Promise.all([before, shown]).then(([state]) => {
        bridge.browser.setActive(selectedRef.current);
        // Reading the ref here, in the cleanup, is the point: restore whatever card is open now.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        if (!selectedRef.current) bridge.browser.setVisible(state.visible);
      }).catch(() => {});
    };
    // selectedRef is a stable ref object, so listing it never re-runs the effect; only showNew does.
  }, [showNew, selectedRef]);
}