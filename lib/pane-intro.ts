"use client";

import { useEffect } from "react";
import type { ShellBridge } from "./client";
import { introSrc, loadSeenIntros, markIntroSeen, type IntroId } from "./feature-intros";
import { openInPane } from "./open-in-pane";
import { prefersStill } from "./use-feature-intro";

// An intro that plays in the browser pane rather than in a frame of its own (lib/feature-intros.ts): the New thread
// dialog's, whose tips are about the pane it plays in. It opens there the first time the dialog opens, once; the
// returned play() opens it again. Only the desktop has a pane (electron/self-url.cjs lets the intro page in): on the
// web, hasPane() is false and the dialog plays it in its own frame instead.

// Partial, as in lib/open-in-pane.ts: a shell from before the pane has no browser bridge.
export function hasPane() {
  if (typeof window === "undefined") return false;
  const pane: Partial<ShellBridge["browser"]> | undefined = window.weft?.browser;
  return typeof pane?.open === "function";
}

export const paneIntroUrl = (id: IntroId, origin: string) => new URL(introSrc(id), origin).href;

export function usePaneIntro(id: IntroId | null): (() => void) | null {
  useEffect(() => {
    if (!id || loadSeenIntros().has(id) || prefersStill()) return;
    markIntroSeen(id);
    openInPane(paneIntroUrl(id, window.location.origin));
  }, [id]);
  return id ? () => openInPane(paneIntroUrl(id, window.location.origin)) : null;
}
