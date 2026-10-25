// Every dialog, sheet and overlay the board puts over its columns, in the order they stack (docs:
// components/Board.tsx used to render these inline, which is where the 300-line cap went). One
// component, one props object: Board passes the open-or-closed value of each, and the close handlers,
// rather than writing nine conditionals itself. Each panel still loads through guarded(), so a module
// that throws as it loads breaks only its own spot.
//
// NewCardDialog stays in Board: it renders inside the board's flow beside the columns (it carries the
// default folder and recent folders), not over the whole sheet like the rest.
"use client";

import { guarded } from "./guarded";
import type { PaletteItem } from "./CommandPalette";
import BoardToast from "./BoardToast";
import type { Card } from "@/lib/types";
import type { LoginView } from "@/lib/types-settings";

const TagsDialog = guarded(() => import("./TagsDialog"), { what: "tags dialog", className: "fixed left-4 top-16 z-50" });
const ShareCardDialog = guarded(() => import("./ShareCardDialog"), { what: "share dialog", className: "fixed left-4 top-16 z-50" });
const ShareBoardDialog = guarded(() => import("./ShareBoardDialog"), { what: "share board dialog", className: "fixed left-4 top-16 z-50" });
const ModifierHint = guarded(() => import("./ModifierHint"), { inline: true, what: "modifier hint", className: "fixed bottom-2 right-2 z-50" });
const LoginDialog = guarded(() => import("./LoginDialog"), { what: "login dialog", className: "fixed left-4 top-16 z-50" });
const FileDrop = guarded(() => import("./FileDrop"), { inline: true, what: "file drop", className: "fixed bottom-6 left-1/2 z-50" });
const SettingsDialog = guarded(() => import("./SettingsDialog"), { what: "settings", className: "fixed left-4 top-16 z-50" });
const ShortcutsDialog = guarded(() => import("./ShortcutsDialog"), { what: "shortcuts sheet", className: "fixed left-4 top-16 z-50" });
const ChangelogDialog = guarded(() => import("./ChangelogDialog"), { what: "changelog", className: "fixed left-4 top-16 z-50" });
const IntakeDialog = guarded(() => import("./IntakeDialog"), { what: "intake screen", className: "fixed left-4 top-16 z-50" });
const CommandPalette = guarded(() => import("./CommandPalette"), { what: "command palette", className: "fixed left-4 top-16 z-50" });

// One tag as the dialog's list draws it: the name and how many cards carry it.
export interface TagOption {
  tag: string;
  count: number;
}

// The board's open/closed state for each overlay. A null or false value is that panel closed, which is
// how Board's useState values and useBoardMenus' Card | null pass through unchanged.
export interface BoardDialogsProps {
  settings: boolean;
  onCloseSettings: () => void;
  help: boolean;
  onCloseHelp: () => void;
  // The card being tagged, null when the dialog is closed.
  tagging: Card | null;
  tagOptions: TagOption[];
  // Every change saves right away; useBoardMenus' saveTags closes over the tagging card.
  onTagsChange: (tags: string[]) => void;
  onCloseTags: () => void;
  // The card being shared, null when the dialog is closed.
  sharing: Card | null;
  onCloseShare: () => void;
  sharingBoard: boolean;
  onCloseShareBoard: () => void;
  palette: boolean;
  paletteQuery: string;
  // A thunk, because the palette only reads the items while it's open (see Board.tsx's lint note).
  paletteItems: () => PaletteItem[];
  findPrompts: (query: string) => Promise<PaletteItem[]>;
  // The project the palette scopes its prompts to, null on no selection.
  paletteProject: { path: string; name: string } | null;
  onClosePalette: () => void;
  // A CLI that needs signing in, null when there's none to sign in to.
  login: LoginView | null;
  onCloseLogin: () => void;
  // The "Switch all to <CLI>" modal, already built by useSwitchAll.
  switchAllDialog: React.ReactNode;
  // The delete-card confirmation, already built by useBoardMenus.
  deleteDialog?: React.ReactNode;
  // FileDrop's targets.
  cards: Card[];
  newOpen: boolean;
  onDropCard: (card: Card) => void;
  onDropNew: () => void;
  // The board's toast (use-toast's Toast) with its own dismiss — the panel never owns that.
  toast: { text: string; action?: { label: string; run: () => void } } | null;
  onDismissToast: () => void;
}

export default function BoardDialogs({
  settings,
  onCloseSettings,
  help,
  onCloseHelp,
  tagging,
  tagOptions,
  onTagsChange,
  onCloseTags,
  sharing,
  onCloseShare,
  sharingBoard,
  onCloseShareBoard,
  palette,
  paletteQuery,
  paletteItems,
  findPrompts,
  paletteProject,
  onClosePalette,
  login,
  onCloseLogin,
  switchAllDialog,
  deleteDialog,
  cards,
  newOpen,
  onDropCard,
  onDropNew,
  toast,
  onDismissToast,
}: BoardDialogsProps) {
  return (
    <>
      {settings && <SettingsDialog onClose={onCloseSettings} />}
      {help && <ShortcutsDialog onClose={onCloseHelp} />}
      {tagging && <TagsDialog card={tagging} all={tagOptions} onChange={onTagsChange} onClose={onCloseTags} />}
      {sharing && <ShareCardDialog card={sharing} onClose={onCloseShare} />}
      {sharingBoard && <ShareBoardDialog onClose={onCloseShareBoard} />}
      {/* Holds its own open flag (lib/changelog-open.ts), so Board passes nothing. */}
      <ChangelogDialog />
      {/* Opened by a project's intake (lib/intake-open.ts), with its own open flag too. */}
      <IntakeDialog />
      <ModifierHint />
      {palette && (
        // paletteItems is a thunk because the palette only reads the rows while it's open; Board
        // builds the list from its current cards, search and filters at the moment it opens.
        <CommandPalette initialQuery={paletteQuery} items={paletteItems()} findPrompts={findPrompts} currentProject={paletteProject} onClose={onClosePalette} />
      )}
      {login && <LoginDialog login={login} onClose={onCloseLogin} />}
      {switchAllDialog}
      {deleteDialog}

      <FileDrop cards={cards} newOpen={newOpen} onOpenCard={onDropCard} onOpenNew={onDropNew} />

      {toast && <BoardToast text={toast.text} action={toast.action} onDismiss={onDismissToast} />}
    </>
  );
}