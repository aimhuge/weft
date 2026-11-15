import type { Pending } from "./dev-idle";
import type { Untracked } from "./dev-untracked";
import { globalSingleton } from "./global-singleton";

// What the idle check (lib/dev-idle-loop.ts) knows between ticks, read by the Services drawer (lib/services-snapshot.ts).
// Its own module so the drawer can read it without importing the loop, which stops servers through lib/services-kill.ts.
export interface IdleState {
  // By run key ("<cardId>", "folder:<cwd>") or "untracked:<pid>": when it last had a visitor or a turn.
  activeAt: Map<string, number>;
  // Untracked servers about to be stopped: the toast's Undo keeps them.
  pending: Map<string, Pending>;
  kept: Set<string>;
  untracked: Untracked[];
  // Each listener's folder, by pid: a process's cwd is read once (lsof), not every minute.
  cwds: Map<number, string>;
}

export const idleState = globalSingleton<IdleState>("__weftDevIdle", () => ({ activeAt: new Map(), pending: new Map(), kept: new Set(), untracked: [], cwds: new Map() }));

// Undo on the toast, Keep in the row: an untracked server Weft won't stop while that process lives.
export function keep(key: string, now = Date.now()) {
  idleState.kept.add(key);
  idleState.pending.delete(key);
  idleState.activeAt.set(key, now);
}
