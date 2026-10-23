// "Replay last achievement" (the avatar menu and the command palette): GameBadge keeps the last popup it opened in
// localStorage, and the menu asks for it again with a window event. Before any popup has opened, the replay is a
// level-up to the level you're on, so the menu item always shows something.
import type { Badge } from "./game-badges";
import type { Level } from "./game";

export const REPLAY_ACHIEVEMENT_EVENT = "weft:achievement-replay";
const LAST = "weft-game-last-achievement";

export interface LastAchievement {
  fresh: Badge[];
  level: Level | null;
}

export function saveLastAchievement(a: LastAchievement) {
  try {
    localStorage.setItem(LAST, JSON.stringify(a));
  } catch {
    // Storage full or blocked: the replay falls back to the current level.
  }
}

export function readLastAchievement(current: Level): LastAchievement {
  try {
    const raw = JSON.parse(localStorage.getItem(LAST) ?? "null") as Partial<LastAchievement> | null;
    const fresh = Array.isArray(raw?.fresh) ? raw.fresh : [];
    const level = raw?.level && typeof raw.level.level === "number" ? raw.level : null;
    if (fresh.length || level) return { fresh, level };
  } catch {
    // A broken entry reads as none.
  }
  return { fresh: [], level: current };
}

export function replayLastAchievement() {
  window.dispatchEvent(new Event(REPLAY_ACHIEVEMENT_EVENT));
}
