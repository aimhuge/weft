"use client";

// The full-page pane's two toggles (docs/architecture/simple-mode.md, piece 1), each for this session only
// (lib/session-flag.ts): a fresh start always shows the page at full width, with no rail and no thread.
// - The show rail folds into a pill in the pane's tab bar; clicking the pill opens it and clicking again folds it.
// - The thread column is hidden, like the phone, where the pane is the app; the live line under the page opens it.
import { sessionFlag } from "./session-flag";

const rail = sessionFlag();
const thread = sessionFlag();

export const railOpen = rail.get;
export const setRailOpen = rail.set;
export const toggleRail = rail.toggle;
export const subscribeRail = rail.subscribe;
export const useRailOpen = rail.use;

export const threadShown = thread.get;
export const setThreadShown = thread.set;
export const toggleThread = thread.toggle;
export const useThreadShown = thread.use;
