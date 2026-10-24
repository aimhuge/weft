"use client";

import { useSyncExternalStore } from "react";

// Whether a feature intro is playing big, in its modal over the window (lib/use-feature-intro.ts), as a tiny store
// outside Board like lib/changelog-open.ts: the intro's drawer or dialog sets it, and lib/use-board-dialogs.ts counts
// it as an overlay so the native browser pane hides under it.

let up = false;
const listeners = new Set<() => void>();

export function setIntroModal(next: boolean) {
  if (up === next) return;
  up = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useIntroModal = () => useSyncExternalStore(subscribe, () => up, () => false);
