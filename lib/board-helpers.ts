"use client";

// Small helpers used by the board: removing one id from a Set, reading the last folder from
// localStorage, firing a desktop notification when a card changes column, and opening a URL in
// the board's browser (or a new tab in plain web mode).
import type { BrowserState } from "./client";
import type { Card } from "./types";

// A new Set with one id removed. Used to keep the "unseen" highlight list up to date when a card
// is opened or deleted.
export function without(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  next.delete(id);
  return next;
}

// The folder the New thread dialog picks when nothing else is set, persisted between sessions
// by Board itself.
export function lastFolder(): string | null {
  try {
    return localStorage.getItem("threadboard.cwd");
  } catch {
    return null;
  }
}

// A desktop notification when a card changes column while the app isn't focused.
export function announce(card: Card, onClick: () => void): void {
  const message =
    card.column === "needs_you"
      ? `${card.title} needs you`
      : card.column === "review"
        ? `${card.title} is ready for review`
        : card.column === "done"
          ? `${card.title} is done`
          : null;
  if (!message || typeof Notification === "undefined" || document.hasFocus()) return;
  if (Notification.permission !== "granted") {
    if (Notification.permission === "default") void Notification.requestPermission();
    return;
  }
  const notification = new Notification(message, { body: card.pending?.title ?? card.lastLine ?? "" });
  notification.onclick = () => {
    window.focus();
    onClick();
  };
}

// In the board's own browser (no card open), or a new tab outside the desktop app.
export function showPage(url: string): void {
  if (window.weft) void window.weft.browser.open(url, "board");
  else window.open(url, "_blank");
}

// The browser pane before the shell has said anything about it.
export const CLOSED_BROWSER: BrowserState = {
  visible: false,
  url: "",
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  zoom: 100,
};
