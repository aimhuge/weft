"use client";

import type { ShellBridge } from "./client";
import { introSrc, type IntroId } from "./feature-intros";

// An intro that plays in the browser pane rather than in a frame of its own (lib/feature-intros.ts): the New thread
// dialog's, whose tips are about the pane it plays in. It never starts on its own (a voice that starts unasked while
// you write is unwelcome): ▶ by the dialog's title plays it in the dialog's own pane (lib/use-new-thread-pane.ts),
// never the board's hidden behind it, and the splash's tips link to it and the drawers' intros (lib/new-thread-tips.ts). Only the desktop has a pane (electron/self-url.cjs lets the intro page in): on the web, hasPane() is false and
// the dialog plays it in its own frame instead.

// Partial, as in lib/open-in-pane.ts: a shell from before the pane has no browser bridge.
export function hasPane() {
  if (typeof window === "undefined") return false;
  const pane: Partial<ShellBridge["browser"]> | undefined = window.weft?.browser;
  return typeof pane?.open === "function";
}

export const paneIntroUrl = (id: IntroId, origin: string) => new URL(introSrc(id), origin).href;

// ▶: plays it again in the pane under `key`, the one showing beside the dialog.
export function playPaneIntro(id: IntroId, key: string) {
  void window.weft?.browser.open(paneIntroUrl(id, window.location.origin), key).catch(() => {});
}
