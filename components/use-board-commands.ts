"use client";

import type { Dispatch, SetStateAction } from "react";
import { api } from "@/lib/client";
import { stopNow } from "@/lib/optimistic-cards";
import { useShortcutListener, useShortcuts } from "@/lib/hotkeys";
import { stepThrough, SORTERS, type ProjectSummary, type SortKey } from "@/lib/board-view";
import { useMenuBridge } from "@/lib/board-menu-bridge";
import { useOnboardingEvents } from "@/lib/onboarding-events";
import { addSecret } from "@/lib/use-vault";
import { filterHasFocus, focusFilter, jumpToNeedsYou, moveFocus, openFocused } from "@/lib/board-focus";
import type { RailPanel } from "@/lib/rail-view";
import type { Card, Column, LoginView } from "@/lib/types";
import type { ColumnId } from "@/lib/workspace-layout";
import type { PaletteItem } from "./CommandPalette";
import { boardPaletteItems, promptItems } from "./board-palette";
import { boardShortcuts } from "./board-shortcuts";

// Everything that drives the board without the mouse on a card: the keyboard shortcuts
// (components/board-shortcuts.ts), the command palette's items (components/board-palette.ts), the app
// menu, dock and tray (lib/board-menu-bridge.ts) and the onboarding's "open New thread" events. Board.tsx
// passes its state and actions in once; the three read the same set.
export interface BoardCommandsInput {
  cards: Card[];
  selected: Card | null;
  // The open card's id, set even before its card has loaded.
  selectedId: string | null;
  projectSummaries: ProjectSummary[];
  project: string | null;
  sort: SortKey;
  home: string;
  // The board's visible columns, in order, for arrow-key focus.
  columns: readonly { id: Column }[];
  query: string;
  // Shortcuts that act on the board stand down while a dialog or the project menu is up.
  boardKeys: boolean;
  dialogs: { showNew: boolean; showSettings: boolean; showHelp: boolean; showPalette: boolean; login: LoginView | null };
  doneToArchive: Card[];
  lastArchived: string[];
  archivedCount: number;
  showArchived: boolean;
  rootOf: (cwd: string) => string;
  // Restart when idle's state (lib/restart-when-idle.ts): armed means it waits for the running threads.
  restart: { armed?: boolean } | null;
  openNew: () => void;
  openCard: (card: Card) => void;
  select: (id: string | null) => void;
  toggleCopilot: () => void;
  toggleBrowser: () => void;
  toggleTerminal: () => void;
  toggleColumn: (id: ColumnId) => void;
  setShowPalette: (open: boolean) => void;
  setPaletteQuery: (query: string) => void;
  setShowHelp: Dispatch<SetStateAction<boolean>>;
  setShowSettings: (open: boolean) => void;
  setSharingBoard: (open: boolean) => void;
  setLibraryOpen: Dispatch<SetStateAction<RailPanel | null>>;
  setShowArchived: Dispatch<SetStateAction<boolean>>;
  archiveTarget: () => Card | undefined;
  archiveCards: (list: Card[]) => void;
  unarchive: (ids: string[]) => void;
  toggleArchive: (card: Card) => void;
  chooseSort: (sort: SortKey) => void;
  chooseProject: (path: string | null) => void;
  move: (id: string, column: Column) => void;
  notify: (err: unknown) => void;
  toast: (message: string) => void;
}

export function useBoardCommands(c: BoardCommandsInput) {
  const { cards, openCard } = c;

  function openPalette(initial: string) {
    c.setPaletteQuery(initial.trim());
    c.setShowPalette(true);
  }

  // Steps through the project filter: "All projects", then each project in the bar's order.
  const stepProject = (by: number) => c.chooseProject(stepThrough([null, ...c.projectSummaries.map((p) => p.path)], c.project, by));
  const stepSort = () => c.chooseSort(stepThrough(Object.keys(SORTERS) as SortKey[], c.sort, 1));

  useMenuBridge({ cards, openNew: c.openNew, openCard, select: c.select, openSettings: () => c.setShowSettings(true), focusFilter, toggleTerminal: c.toggleTerminal, openDrawer: c.setLibraryOpen });
  useOnboardingEvents(c.openNew, c.select);

  useShortcuts(
    boardShortcuts({
      ...c.dialogs,
      query: c.query,
      boardKeys: c.boardKeys,
      cardOpen: Boolean(c.selectedId),
      doneToArchive: c.doneToArchive,
      lastArchived: c.lastArchived,
      setShowPalette: c.setShowPalette,
      setShowHelp: c.setShowHelp,
      setShowSettings: c.setShowSettings,
      setLibraryOpen: c.setLibraryOpen,
      openPalette,
      filterHasFocus,
      openNew: c.openNew,
      focusFilter,
      toggleCopilot: c.toggleCopilot,
      toggleBrowser: c.toggleBrowser,
      toggleTerminal: c.toggleTerminal,
      toggleColumn: c.toggleColumn,
      // Focus helpers (lib/board-focus.ts), bound to the board's column and card layout.
      moveFocus: (move) => moveFocus(move, c.columns, c.selectedId, c.selected?.column ?? null),
      openFocused: (e) => openFocused(e, cards, openCard),
      jumpToNeedsYou,
      stepProject,
      stepSort,
      archiveTarget: c.archiveTarget,
      toggleArchive: c.toggleArchive,
      archiveCards: c.archiveCards,
      unarchive: c.unarchive,
    }),
  );
  useShortcutListener();

  // Everything the command palette offers: the board's actions, the projects, and every card. Only
  // built while the palette is open, so a closed palette doesn't churn a fresh array every render.
  function paletteItems(): PaletteItem[] {
    if (!c.dialogs.showPalette) return [];
    return boardPaletteItems(
      { cards, selected: c.selected, projectSummaries: c.projectSummaries, home: c.home, doneToArchive: c.doneToArchive, lastArchived: c.lastArchived, archivedCount: c.archivedCount, showArchived: c.showArchived, rootOf: c.rootOf, restartArmed: Boolean(c.restart?.armed) },
      {
        openNew: c.openNew,
        focusFilter,
        toggleCopilot: c.toggleCopilot,
        toggleBrowser: c.toggleBrowser,
        toggleTerminal: c.toggleTerminal,
        openSettings: () => c.setShowSettings(true),
        shareBoard: () => c.setSharingBoard(true),
        openHelp: () => c.setShowHelp(true),
        addSecret: () => addSecret(c.setLibraryOpen),
        jumpToNeedsYou: () => void jumpToNeedsYou(),
        archiveCards: c.archiveCards,
        unarchive: c.unarchive,
        toggleShowArchived: () => c.setShowArchived((v) => !v),
        chooseSort: c.chooseSort,
        focusReply: () => document.querySelector<HTMLElement>('aside [contenteditable="true"], aside textarea')?.focus(),
        closeThread: () => c.select(null),
        toggleArchive: c.toggleArchive,
        stop: (id) => void stopNow(id).catch(c.notify),
        move: c.move,
        chooseProject: c.chooseProject,
        openCard,
        toast: c.toast,
      },
    );
  }

  // The prompts the user wrote that match a query, as palette items that open their card.
  async function findPrompts(query: string): Promise<PaletteItem[]> {
    const { hits } = await api.searchPrompts(query);
    return promptItems(hits, cards, c.rootOf, openCard);
  }

  return { openPalette, paletteItems, findPrompts };
}
