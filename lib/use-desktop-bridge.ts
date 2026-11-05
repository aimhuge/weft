"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { BrowserState } from "./client";
import { COPILOT_ID, type Card } from "./types";
import { syncDictationShortcut } from "./shortcuts";
import { useTitleBarZoom } from "./use-title-bar-zoom";

const noopSubscribe = () => () => {};

// The board's side of the Electron preload bridge (window.weft): whether it's there at all, the
// browser pane's and copilot window's state, and keeping each card's browser and the dock badge in step
// with the board. In a plain browser tab it reports `closed` and does nothing.
export function useDesktopBridge(closed: BrowserState, selectedId: string | null, cards: Card[]) {
  const [browser, setBrowser] = useState<BrowserState>(closed);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const desktop = useSyncExternalStore(noopSubscribe, () => Boolean(window.weft), () => false);
  // On macOS the header doubles as the title bar, under the window's traffic lights.
  const mac = useSyncExternalStore(noopSubscribe, () => window.weft?.platform ?? "", () => "") === "darwin";
  useTitleBarZoom();

  useEffect(() => {
    const bridge = window.weft;
    if (!bridge) return;
    void bridge.browser.getState().then(setBrowser);
    const offBrowser = bridge.browser.onState(setBrowser);
    const offCopilot = bridge.copilot.onState((state) => setCopilotOpen(state.open));
    // The dictation key is the board's own setting; main registers it in every app.
    syncDictationShortcut();
    return () => {
      offBrowser();
      offCopilot();
    };
  }, []);

  // Each card has its own browser: show the open card's, and close those of cards that are gone.
  useEffect(() => {
    window.weft?.browser.setActive(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (cards.length) window.weft?.browser.prune([...cards.map((c) => c.id), COPILOT_ID]);
  }, [cards]);

  useEffect(() => {
    window.weft?.setBadge(cards.filter((c) => c.column === "needs_you").length);
  }, [cards]);

  return { desktop, mac, browser, copilotOpen };
}
