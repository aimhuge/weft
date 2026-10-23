"use client";

// The board's top bar: logo, "N running / M need you" status, restart chip, header badges, the
// browser / terminal / settings / new-thread buttons, and the account button. Each button gets
// the keyboard hint that lives in the hotkeys registry.
import type { ReactNode } from "react";
import Icon from "./Icon";

export interface BoardHeaderProps {
  mac: boolean;
  // Unarchived cards in Running and Needs you.
  counts: { running: number; waiting: number };
  hint: (id: string, fallback: string) => string;
  // The browser and terminal buttons, lit while their panes are open.
  panes: { browserOpen: boolean; terminalOpen: boolean; onToggleBrowser: () => void; onToggleTerminal: () => void };
  onShareBoard: () => void;
  onOpenSettings: () => void;
  onOpenNew: () => void;
  // The four load-in-CrashGuard elements; each is a guarded() component from Board.tsx.
  slots: { restart: ReactNode; badges: ReactNode; copilot: ReactNode; account: ReactNode };
}

export default function BoardHeader({
  mac,
  counts: { running, waiting },
  hint,
  panes: { browserOpen, terminalOpen, onToggleBrowser, onToggleTerminal },
  onShareBoard,
  onOpenSettings,
  onOpenNew,
  slots,
}: BoardHeaderProps) {
  return (
    <header
      className={`flex shrink-0 items-center gap-3 border-b border-line bg-panel ${mac ? "app-drag mac-title-bar pr-4" : "px-4 py-2.5"}`}
    >
      <h1 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
        <img src="/app-icon.png" alt="" width={28} height={28} />
        Weft
      </h1>
      <span className="text-[12px] text-muted">
        {running} running
        {waiting > 0 && <span className="text-warn"> · {waiting} need{waiting === 1 ? "s" : ""} you</span>}
      </span>
      {slots.restart}
      {slots.badges}
      <div className="flex-1" />
      {slots.copilot}
      <button
        onClick={onToggleBrowser}
        title={hint("browser", "Browser")}
        aria-label="Browser"
        className={`rounded-md border p-1.5 ${browserOpen ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-ink hover:bg-sunken"}`}
      >
        <Icon name="globe" size={15} />
      </button>
      <button
        onClick={onToggleTerminal}
        title={hint("terminal", "Terminal")}
        aria-label="Terminal"
        className={`rounded-md border p-1.5 ${terminalOpen ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-muted hover:bg-sunken hover:text-ink"}`}
      >
        <Icon name="terminal" size={15} />
      </button>
      <button
        onClick={onShareBoard}
        title={hint("share-board", "Share the board")}
        aria-label="Share the board"
        className="rounded-md border border-line-strong p-1.5 text-muted hover:bg-sunken hover:text-ink"
      >
        <Icon name="share" size={15} />
      </button>
      <button
        onClick={onOpenSettings}
        title={hint("settings", "Settings")}
        aria-label="Settings"
        className="rounded-md border border-line-strong p-1.5 text-muted hover:bg-sunken hover:text-ink"
      >
        <Icon name="sliders" size={15} />
      </button>
      <button
        onClick={onOpenNew}
        title={hint("new-thread", "New thread")}
        aria-label="New thread"
        className="flex items-center gap-1 rounded-md bg-accent px-2 py-1.5 text-on-accent hover:opacity-90"
      >
        <Icon name="plus" size={15} />
      </button>
      {slots.account}
    </header>
  );
}
