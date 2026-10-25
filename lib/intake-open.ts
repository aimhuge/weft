"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { IntakeResult } from "./project-intake";
import type { RailPanel } from "./rail-view";

// The intake screen that's open (components/IntakeDialog.tsx), as a tiny store outside Board, like
// lib/changelog-open.ts: lib/use-board-view.ts opens it when an intake took something in, the dialog draws from
// it, and lib/use-board-dialogs.ts counts it as an overlay so the native browser pane hides under it. The board's
// commands hook registers what the dialog's buttons need (open a drawer, open a card), so Board passes nothing.

export type OpenIntake = { folder: string; result: IntakeResult };
export type IntakeActions = { openDrawer: (panel: RailPanel) => void; select: (id: string | null) => void };

let open: OpenIntake | null = null;
let actions: IntakeActions | null = null;
const listeners = new Set<() => void>();

function set(next: OpenIntake | null) {
  open = next;
  for (const listener of listeners) listener();
}

export const openIntake = (folder: string, result: IntakeResult) => set({ folder, result });
export const closeIntake = () => set(null);
export const intakeActions = () => actions;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useOpenIntake = () => useSyncExternalStore(subscribe, () => open, () => null);

/** Board's side: what the intake screen's buttons call, for as long as the board is mounted. */
export function useIntakeActions(openDrawer: IntakeActions["openDrawer"], select: IntakeActions["select"]) {
  useEffect(() => {
    actions = { openDrawer, select };
    return () => {
      actions = null;
    };
  }, [openDrawer, select]);
}
