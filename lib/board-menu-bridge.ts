import { useEffect, useRef } from "react";
import type { MenuAction } from "./client";
import { paneFindFocused, requestThreadFind, stepThreadFind } from "./find-events";
import { requestAddressFocus } from "./pane-new-tab";
import type { Card } from "./types";
import { OPEN_SETTINGS_EVENT } from "./secrets-settings";
import { askVault, parseVaultAsk } from "./vault-ask";
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
  // A thread is open with no dialog over it, so ⌘F finds in it.
  threadOpen?: boolean;
  toggleTerminal: () => void;
  openDrawer: (panel: "webhooks" | "vault") => void;
}

// ⌘F and ⌘G. "pane" means the page had the focus, and the pane's own find field has it now if paneFindFocused:
// either way they're the browser pane's (components/PaneFind.tsx). Settings' search listens for itself.
function runFind(action: "find" | "find-next" | "find-previous", payload: string | undefined, b: MenuBridge) {
  if (payload === "pane" || paneFindFocused()) return;
  if (action === "find-next" || action === "find-previous") stepThreadFind(action === "find-next" ? 1 : -1);
  else if (!b.cardOpen) b.focusFilter();
  else if (b.threadOpen) requestThreadFind();
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
    case "find-next":
    case "find-previous":
      runFind(action, payload, b);
      break;
    case "terminal":
      b.toggleTerminal();
      break;
    // ⌘T: main has opened the blank tab; its address bar takes the keyboard.
    case "new-tab":
      requestAddressFocus();
      break;
    // A thread added a webhook for you to register: the 🪝 drawer opens on its row.
    case "add-webhook":
      addWebhookAsk(b.openDrawer, parseWebhookAsk(payload));
      break;
    // weft://secrets?repo=…&share=1, from the team page: the 🔐 drawer opens on that repo, Share… up when asked.
    case "open-secrets":
      askVault(b.openDrawer, parseVaultAsk(payload));
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
  // Settings → Secrets asked for from the 🔐 drawer or a weft://secrets link (lib/secrets-settings.ts).
  useEffect(() => {
    const open = () => latest.current.openSettings();
    window.addEventListener(OPEN_SETTINGS_EVENT, open);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, open);
  }, []);
}
