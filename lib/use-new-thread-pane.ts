"use client";

import { useEffect, useState, type RefObject } from "react";
import { api } from "./client";

// The browser pane's page beside the New thread dialog (not a card's).
export const NEW_THREAD_PANE = "new-thread";

// While the New thread dialog is up, the browser pane beside it shows the splash and its tips (lib/new-thread-tips.ts).
// Nothing plays on its own there, so no voice starts while you write: an intro plays only when you ask, with ▶ by the
// dialog's title (lib/pane-intro.ts) or a tip's ▶ Watch, in this same pane. Closing it
// goes back to the open card's browser (a card just started is open by then), or the pane as it was.
//
// Returns the pane's visibility from before the dialog opened while that is being restored, else null.
// Opening the splash makes the pane visible, so without it the board's own pane remounts open on close
// and then slides shut once the restore lands; the board reads this instead until the two agree.
export function useNewThreadPane(showNew: boolean, selectedRef: RefObject<string | null>, visible = false): boolean | null {
  const [held, setHeld] = useState<boolean | null>(null);
  const [was, setWas] = useState(showNew);
  // Set while rendering, so the very render that closes the dialog already holds the old state.
  if (showNew !== was) {
    setWas(showNew);
    if (showNew) setHeld(visible);
  }
  if (!showNew && held !== null && visible === held) setHeld(null);

  useEffect(() => {
    const bridge = window.weft;
    if (!showNew || !bridge) return;
    const before = bridge.browser.getState();
    const shown = api.newThreadPage().then(({ url }) => bridge.browser.open(url, NEW_THREAD_PANE)).catch(() => {});
    return () => {
      void Promise.all([before, shown]).then(([state]) => {
        bridge.browser.setActive(selectedRef.current);
        // Reading the ref here, in the cleanup, is the point: restore whatever card is open now.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        if (!selectedRef.current) bridge.browser.setVisible(state.visible);
        // A card is open (its own pane, the board's is hidden): nothing to hold for.
        else setHeld(null);
      }).catch(() => setHeld(null));
    };
    // selectedRef is a stable ref object, so listing it never re-runs the effect; only showNew does.
  }, [showNew, selectedRef]);

  return showNew ? null : held;
}
