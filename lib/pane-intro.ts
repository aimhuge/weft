"use client";

import type { ShellBridge } from "./client";
import { introSrc, loadSeenIntros, markIntroSeen, type IntroId } from "./feature-intros";
import { prefersStill } from "./use-feature-intro";

// An intro that plays in the browser pane rather than in a frame of its own (lib/feature-intros.ts): the New thread
// dialog's, whose tips are about the pane it plays in. The first time the dialog opens it plays in place of the
// splash (lib/use-new-thread-pane.ts), in the dialog's own pane, never the board's hidden behind it; ▶ plays it there
// again. Only the desktop has a pane (electron/self-url.cjs lets the intro page in): on the web, hasPane() is false and
// the dialog plays it in its own frame instead.

// Partial, as in lib/open-in-pane.ts: a shell from before the pane has no browser bridge.
export function hasPane() {
  if (typeof window === "undefined") return false;
  const pane: Partial<ShellBridge["browser"]> | undefined = window.weft?.browser;
  return typeof pane?.open === "function";
}

export const paneIntroUrl = (id: IntroId, origin: string) => new URL(introSrc(id), origin).href;

// The intro's address when it is due to play on its own (not seen yet, motion allowed), marking it seen; else null.
export function takePaneIntro(id: IntroId): string | null {
  if (loadSeenIntros().has(id) || prefersStill()) return null;
  markIntroSeen(id);
  return paneIntroUrl(id, window.location.origin);
}

// ▶: plays it again in the pane under `key`, the one showing beside the dialog.
export function playPaneIntro(id: IntroId, key: string) {
  void window.weft?.browser.open(paneIntroUrl(id, window.location.origin), key).catch(() => {});
}
