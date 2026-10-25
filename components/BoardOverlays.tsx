"use client";

// The board's overlays: the framed window (New thread, or an open card's thread) and the dialogs
// that stack over the columns. They live together so Board.tsx stays a short list of what the board
// shows, rather than two long piles of prop bundles.
import type { ReactNode } from "react";
import type { BrowserState, NewCardInput } from "@/lib/client";
import type { Card, RestartStatus, ThreadItem } from "@/lib/types";
import type { UseWorkspaceLayout } from "@/lib/use-workspace-layout";
import type { threadHandlers } from "@/lib/thread-handlers";
import type { PaletteItem } from "./CommandPalette";
import type { TagOption } from "./BoardDialogs";
import type { LoginView } from "@/lib/types-settings";
import BoardFrame from "./BoardFrame";
import { guarded } from "./guarded";

// Every dialog, sheet and overlay over the board's columns — Settings, Tags…, Share…, the palette,
// file drop, the toast — each loading through its own guarded() import (components/BoardDialogs.tsx).
const BoardDialogs = guarded(() => import("./BoardDialogs"), { what: "dialogs", inline: true });

// The framed window's state.
export interface BoardFrameState {
  showNew: boolean;
  selected: Card | null;
  cards: Card[];
  home: string;
  newCwd?: string;
  project: string | null;
  restart: RestartStatus | null;
  onCreate: (input: NewCardInput, opts?: { stay?: boolean }) => Promise<void>;
  onCloseNew: () => void;
  items: ThreadItem[];
  handlers: ReturnType<typeof threadHandlers> | null;
  streaming: string;
  renameId: string | null;
  workspace: UseWorkspaceLayout;
  desktop: boolean;
  browser: BrowserState;
  obscured: boolean;
  browserWidth: number;
  onBrowserWidth: (width: number) => void;
  onStar: () => void;
  onTags: () => void;
  onShare: () => void;
  onArchive: () => void;
  onOpenSettings: () => void;
  bottom: number | undefined;
  onBackdrop: () => void;
}

// The dialogs' state.
export interface BoardDialogsState {
  settings: boolean;
  onCloseSettings: () => void;
  help: boolean;
  onCloseHelp: () => void;
  tagging: Card | null;
  tagOptions: TagOption[];
  onTagsChange: (tags: string[]) => void;
  onCloseTags: () => void;
  sharing: Card | null;
  onCloseShare: () => void;
  sharingBoard: boolean;
  onCloseShareBoard: () => void;
  palette: boolean;
  paletteQuery: string;
  paletteItems: () => PaletteItem[];
  findPrompts: (query: string) => Promise<PaletteItem[]>;
  paletteProject: { path: string; name: string } | null;
  onClosePalette: () => void;
  login: LoginView | null;
  onCloseLogin: () => void;
  switchAllDialog: ReactNode;
  deleteDialog?: ReactNode;
  newOpen: boolean;
  onDropCard: (card: Card) => void;
  onDropNew: () => void;
  toast: { text: string; action?: { label: string; run: () => void } } | null;
  onDismissToast: () => void;
}

export interface BoardOverlaysProps {
  frame: BoardFrameState;
  dialogs: BoardDialogsState;
}

export default function BoardOverlays({ frame, dialogs }: BoardOverlaysProps) {
  return (
    <>
      <BoardFrame {...frame} />
      <BoardDialogs {...dialogs} cards={frame.cards} />
    </>
  );
}
