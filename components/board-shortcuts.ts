import type { Dispatch, SetStateAction } from "react";
import type { ShortcutDef } from "@/lib/hotkeys";
import type { RailPanel } from "@/lib/rail-view";
import { addSecret } from "@/lib/use-vault";
import type { Card, LoginView } from "@/lib/types";
import type { ColumnId } from "@/lib/workspace-layout";

// The board's keyboard shortcuts (Board.tsx), from the state and actions they read.
export interface BoardShortcutContext {
  showNew: boolean;
  showSettings: boolean;
  showHelp: boolean;
  showPalette: boolean;
  login: LoginView | null;
  query: string;
  // Shortcuts that act on the board stand down while a dialog or the project menu is up.
  boardKeys: boolean;
  // True when a card is open: required for the column toggles, which only act on the workspace.
  cardOpen: boolean;
  doneToArchive: Card[];
  lastArchived: string[];
  setShowPalette: (open: boolean) => void;
  setShowHelp: Dispatch<SetStateAction<boolean>>;
  setShowSettings: (open: boolean) => void;
  setLibraryOpen: Dispatch<SetStateAction<RailPanel | null>>;
  openPalette: (initial: string) => void;
  filterHasFocus: () => boolean;
  openNew: () => void;
  focusFilter: () => void;
  toggleCopilot: () => void;
  toggleBrowser: () => void;
  toggleTerminal: () => void;
  // Toggle a column in the open-card workspace (lib/workspace-layout.ts). No-op without a card.
  toggleColumn: (id: ColumnId) => void;
  moveFocus: (move: { dx?: number; dy?: number; edge?: "first" | "last" }) => void;
  openFocused: (e: KeyboardEvent) => false | undefined;
  jumpToNeedsYou: () => false | undefined;
  // Opens the card you had open last (still outlined on the board); false when there's none to open.
  reopenLast: () => false | undefined;
  stepProject: (by: number) => void;
  stepSort: () => void;
  archiveTarget: () => Card | undefined;
  toggleArchive: (card: Card) => void;
  archiveCards: (list: Card[]) => void;
  unarchive: (ids: string[]) => void;
}

export function boardShortcuts(c: BoardShortcutContext): ShortcutDef[] {
  return [
    {
      id: "palette",
      keys: ["mod+k"],
      description: "Command palette: search cards and run commands",
      group: "General",
      // Settings stays open underneath: the palette stacks above it (Modal layer "palette").
      enabled: !(c.showNew || c.showHelp || Boolean(c.login)),
      // From the filter box, the palette picks up what was typed there.
      handler: () => (c.showPalette ? c.setShowPalette(false) : c.openPalette(c.filterHasFocus() ? c.query : "")),
    },
    {
      id: "help",
      keys: ["?", "mod+/"],
      description: "Show keyboard shortcuts",
      group: "General",
      enabled: !(c.showNew || c.showSettings || c.showPalette || Boolean(c.login)),
      handler: () => c.setShowHelp((open) => !open),
    },
    { id: "new-thread", keys: ["n"], description: "New thread", group: "General", enabled: c.boardKeys, handler: () => c.openNew() },
    {
      id: "library",
      keys: ["mod+l"],
      description: "Tags: filter the board, add, rename, recolour",
      group: "General",
      enabled: !(c.showNew || c.showSettings || c.showPalette || c.showHelp || Boolean(c.login)),
      handler: () => c.setLibraryOpen((open) => (open ? null : "tags")),
    },
    { id: "add-secret", keys: ["shift+s"], description: "Add a secret to the vault", group: "General", enabled: c.boardKeys, handler: () => addSecret(c.setLibraryOpen) },
    { id: "filter", keys: ["/"], description: "Filter cards", group: "General", enabled: c.boardKeys, handler: c.focusFilter },
    {
      id: "settings",
      keys: [","],
      description: "Open settings",
      group: "General",
      enabled: c.boardKeys,
      handler: () => c.setShowSettings(true),
    },
    { id: "copilot", keys: ["c"], description: "Open or close the copilot", group: "General", enabled: c.boardKeys, handler: c.toggleCopilot },
    { id: "browser", keys: ["b"], description: "Toggle the browser", group: "General", enabled: c.boardKeys, handler: c.toggleBrowser },
    { id: "terminal", keys: ["t"], description: "Toggle the terminal", group: "General", enabled: c.boardKeys, handler: c.toggleTerminal },
    // The four-column workspace for an open card (lib/workspace-layout.ts). ⌥⌘1..4 sit on free
    // keys (the App group owns ⌘1/⌘2, ⌥⌘ are not used elsewhere in lib/shortcut-catalog.ts) and
    // stand down without a card.
    { id: "column-thread", keys: ["alt+mod+1"], description: "Toggle the thread column", group: "General", enabled: c.boardKeys && c.cardOpen, handler: () => c.toggleColumn("thread") },
    { id: "column-editor", keys: ["alt+mod+2"], description: "Toggle the editor column", group: "General", enabled: c.boardKeys && c.cardOpen, handler: () => c.toggleColumn("editor") },
    { id: "column-pane", keys: ["alt+mod+3"], description: "Toggle the browser column", group: "General", enabled: c.boardKeys && c.cardOpen, handler: () => c.toggleColumn("pane") },
    { id: "column-show", keys: ["alt+mod+4"], description: "Toggle the show column", group: "General", enabled: c.boardKeys && c.cardOpen, handler: () => c.toggleColumn("show") },
    {
      id: "card-down",
      keys: ["j", "ArrowDown"],
      description: "Next card in the column",
      group: "Board",
      enabled: c.boardKeys,
      handler: () => c.moveFocus({ dy: 1 }),
    },
    {
      id: "card-up",
      keys: ["k", "ArrowUp"],
      description: "Previous card in the column",
      group: "Board",
      enabled: c.boardKeys,
      handler: () => c.moveFocus({ dy: -1 }),
    },
    {
      id: "column-right",
      keys: ["l", "ArrowRight"],
      description: "Move to the next column",
      group: "Board",
      enabled: c.boardKeys,
      handler: () => c.moveFocus({ dx: 1 }),
    },
    {
      id: "column-left",
      keys: ["h", "ArrowLeft"],
      description: "Move to the previous column",
      group: "Board",
      enabled: c.boardKeys,
      handler: () => c.moveFocus({ dx: -1 }),
    },
    {
      id: "card-first",
      keys: ["Home"],
      description: "First card in the column",
      group: "Board",
      enabled: c.boardKeys,
      handler: () => c.moveFocus({ edge: "first" }),
    },
    {
      id: "card-last",
      keys: ["End"],
      description: "Last card in the column",
      group: "Board",
      enabled: c.boardKeys,
      handler: () => c.moveFocus({ edge: "last" }),
    },
    {
      id: "card-open",
      keys: ["Enter", "o"],
      description: "Open the focused card",
      group: "Board",
      enabled: c.boardKeys,
      handler: c.openFocused,
    },
    {
      id: "needs-you",
      keys: ["a"],
      description: "Jump to a card that needs you",
      group: "Board",
      enabled: c.boardKeys,
      handler: c.jumpToNeedsYou,
    },
    { id: "reopen-last", keys: ["z"], description: "Reopen the last card you had open", group: "Board", enabled: c.boardKeys, handler: c.reopenLast },
    { id: "project-next", keys: ["]"], description: "Next project", group: "Board", enabled: c.boardKeys, handler: () => c.stepProject(1) },
    {
      id: "project-previous",
      keys: ["["],
      description: "Previous project",
      group: "Board",
      enabled: c.boardKeys,
      handler: () => c.stepProject(-1),
    },
    { id: "sort", keys: ["s"], description: "Change the sort order", group: "Board", enabled: c.boardKeys, handler: c.stepSort },
    {
      id: "reply",
      keys: ["r"],
      description: "Reply in the open thread",
      group: "Thread",
      enabled: c.boardKeys,
      handler: () => {
        const input = document.querySelector<HTMLElement>('aside [contenteditable="true"], aside textarea');
        if (!input) return false;
        input.focus();
      },
    },
    {
      id: "archive",
      keys: ["shift+a"],
      description: "Archive the focused card, or the open thread",
      group: "Board",
      enabled: c.boardKeys,
      handler: () => {
        const card = c.archiveTarget();
        if (!card) return false;
        c.toggleArchive(card);
      },
    },
    {
      id: "archive-done",
      keys: ["shift+e"],
      description: "Archive every card shown in Done",
      group: "Board",
      enabled: c.boardKeys,
      handler: () => {
        if (!c.doneToArchive.length) return false;
        c.archiveCards(c.doneToArchive);
      },
    },
    {
      id: "archive-undo",
      keys: ["shift+z"],
      description: "Undo the last archive",
      group: "Board",
      enabled: c.boardKeys,
      handler: () => {
        if (!c.lastArchived.length) return false;
        c.unarchive(c.lastArchived);
      },
    },
  ];
}
