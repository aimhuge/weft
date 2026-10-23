import { useState, type Dispatch, type SetStateAction } from "react";
import { useChangelogFolder } from "./changelog-open";
import type { LoginView } from "./types";

// The board's dialog flags in one place, out of Board.tsx: what it stacks over its columns, and
// which of those cover the native browser pane. Eight useStates became one hook so the board's body
// reads as wiring instead of a wall of flags, and so the derived rules below can be tested on their own.

// The flags dialogLayers reads. Every one of them, on its own, puts something over the board.
export interface DialogFlags {
  showNew: boolean;
  showSettings: boolean;
  showHelp: boolean;
  showPalette: boolean;
  login: LoginView | null;
  // The project bar's dropdown, which is a menu rather than a dialog but covers the board the same way.
  menuOpen: boolean;
  // A project's Changelog dialog (lib/changelog-open.ts), which holds its own open flag.
  changelog?: boolean;
}

// Whether a dialog, sign-in or menu is over the board (the native browser pane hides under it), and
// whether the shortcuts that act on the board still stand down.
export function dialogLayers(flags: DialogFlags) {
  const overlay = flags.showSettings || flags.showHelp || flags.showPalette || Boolean(flags.login) || flags.menuOpen || Boolean(flags.changelog);
  return { overlay, boardKeys: !(flags.showNew || overlay) };
}

// The setters are React's own, so updaters work (the help shortcut flips with setShowHelp((open) => !open)).
type Set<T> = Dispatch<SetStateAction<T>>;

export interface BoardDialogs {
  showNew: boolean;
  setShowNew: Set<boolean>;
  menuOpen: boolean;
  setMenuOpen: Set<boolean>;
  showSettings: boolean;
  setShowSettings: Set<boolean>;
  sharingBoard: boolean;
  setSharingBoard: Set<boolean>;
  showHelp: boolean;
  setShowHelp: Set<boolean>;
  showPalette: boolean;
  setShowPalette: Set<boolean>;
  paletteQuery: string;
  setPaletteQuery: Set<string>;
  login: LoginView | null;
  setLogin: Set<LoginView | null>;
  // A dialog, sign-in or menu is over the board: the native browser pane hides under it.
  overlay: boolean;
  // Shortcuts that act on the board stand down while a dialog or the project menu is up.
  boardKeys: boolean;
}

export function useBoardDialogs(): BoardDialogs {
  const [showNew, setShowNew] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sharingBoard, setSharingBoard] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [login, setLogin] = useState<LoginView | null>(null);
  const changelog = useChangelogFolder() !== null;
  const { overlay, boardKeys } = dialogLayers({ showNew, showSettings, showHelp, showPalette, login, menuOpen, changelog });
  return {
    showNew,
    setShowNew,
    menuOpen,
    setMenuOpen,
    showSettings,
    setShowSettings,
    sharingBoard,
    setSharingBoard,
    showHelp,
    setShowHelp,
    showPalette,
    setShowPalette,
    paletteQuery,
    setPaletteQuery,
    login,
    setLogin,
    overlay,
    boardKeys,
  };
}