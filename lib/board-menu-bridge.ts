import { useEffect, useRef } from "react";
import type { MenuAction } from "./client";
import type { Card } from "./types";
import { addWebhookAsk } from "./use-webhooks";
import { parseWebhookAsk } from "./webhooks-view";

// What the app menu, dock, tray and global shortcuts ask the board to do (electron/menus.cjs sends them).
export interface MenuBridge {
  cards: Card[];
  openNew: () => void;
  openCard: (card: Card) => void;
  // A card the board doesn't list (the copilot, or one not loaded yet) opens by id.
  select: (id: string) => void;
  openSettings: () => void;
  focusFilter: () => void;
  // A card or a dialog is open: ⌘F belongs to it then (the thread, Settings' search), not the board's filter box behind it.
  cardOpen?: boolean;
  toggleTerminal: () => void;
  openDrawer: (panel: "webhooks") => void;
}

export function runMenuAction(action: MenuAction, payload: string | undefined, b: MenuBridge) {
  switch (action) {
    case "new-thread":
      b.openNew();
      break;
    case "settings":
      b.openSettings();
      break;
    case "open-card": {
      const card = b.cards.find((c) => c.id === payload);
      if (card) b.openCard(card);
      else if (payload) b.select(payload);
      break;
    }
    case "find":
      if (!b.cardOpen) b.focusFilter();
      break;
    case "terminal":
      b.toggleTerminal();
      break;
    // A thread added a webhook for you to register: the 🪝 drawer opens on its row.
    case "add-webhook":
      addWebhookAsk(b.openDrawer, parseWebhookAsk(payload));
      break;
  }
}

// Listens once for the desktop's menu actions and runs each against the board's latest state.
export function useMenuBridge(bridge: MenuBridge) {
  const latest = useRef(bridge);
  useEffect(() => {
    latest.current = bridge;
  });
  useEffect(() => window.weft?.onMenu((action, payload) => runMenuAction(action, payload, latest.current)), []);
}
