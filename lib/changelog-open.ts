"use client";

import { useSyncExternalStore } from "react";

// Which project's Changelog dialog is open (components/ChangelogDialog.tsx), as a tiny store outside Board: the project
// menu and the command palette open it, the dialog draws from it, and lib/use-board-dialogs.ts counts it as an
// overlay so the native browser pane hides under it. Board itself never holds the flag.

let folder: string | null = null;
const listeners = new Set<() => void>();

function set(next: string | null) {
  folder = next;
  for (const listener of listeners) listener();
}

export const openChangelog = (project: string) => set(project);
export const closeChangelog = () => set(null);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useChangelogFolder = () => useSyncExternalStore(subscribe, () => folder, () => null);
