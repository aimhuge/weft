// Board layout choices from Settings. Like the theme (lib/theme.ts) they live in a cookie, since the
// desktop server's port can change. Changes fire an event so the board updates without a reload.
const BACKLOG_COOKIE = "weft-show-backlog";
const EVENT = "weft-board-prefs";

// Off by default: cards start right away, so the Backlog column is usually empty.
export function showBacklog(): boolean {
  if (typeof document === "undefined") return false;
  return new RegExp(`(?:^|; )${BACKLOG_COOKIE}=1`).test(document.cookie);
}

export function setShowBacklog(on: boolean) {
  document.cookie = `${BACKLOG_COOKIE}=${on ? 1 : 0}; path=/; max-age=${10 * 365 * 24 * 60 * 60}; SameSite=Lax`;
  window.dispatchEvent(new Event(EVENT));
}

const PROGRESS_COOKIE = "weft-show-progress";

// On by default: the header's streak and level chip (components/GameBadge.tsx). Off is quiet mode.
export function showProgress(): boolean {
  if (typeof document === "undefined") return true;
  return !new RegExp(`(?:^|; )${PROGRESS_COOKIE}=0`).test(document.cookie);
}

export function setShowProgress(on: boolean) {
  document.cookie = `${PROGRESS_COOKIE}=${on ? 1 : 0}; path=/; max-age=${10 * 365 * 24 * 60 * 60}; SameSite=Lax`;
  window.dispatchEvent(new Event(EVENT));
}

// How the board lays its cards out: as columns (the default) or as one list of every card.
export type ViewMode = "board" | "list";

const VIEW_COOKIE = "weft-view-mode";

export function viewMode(): ViewMode {
  if (typeof document === "undefined") return "board";
  return new RegExp(`(?:^|; )${VIEW_COOKIE}=list`).test(document.cookie) ? "list" : "board";
}

export function setViewMode(mode: ViewMode) {
  document.cookie = `${VIEW_COOKIE}=${mode}; path=/; max-age=${10 * 365 * 24 * 60 * 60}; SameSite=Lax`;
  window.dispatchEvent(new Event(EVENT));
}

const LANE_COOKIE = "weft-copilot-lane";
const PEEK_COOKIE = "weft-copilot-peek";

// The copilot's lane has three states (lib/copilot-lane.ts): hidden (the hider pill), peek (the digest
// column), and open (the chat). The open state has its own cookie; the peek state has one too so it
// sticks across reloads when you hover the hider and decide to look away.
export function copilotLaneOpen(): boolean {
  if (typeof document === "undefined") return false;
  return new RegExp(`(?:^|; )${LANE_COOKIE}=1`).test(document.cookie);
}

export function setCopilotLaneOpen(open: boolean) {
  document.cookie = `${LANE_COOKIE}=${open ? 1 : 0}; path=/; max-age=${10 * 365 * 24 * 60 * 60}; SameSite=Lax`;
  window.dispatchEvent(new Event(EVENT));
}

export function copilotLanePeek(): boolean {
  if (typeof document === "undefined") return false;
  return new RegExp(`(?:^|; )${PEEK_COOKIE}=1`).test(document.cookie);
}

export function setCopilotLanePeek(peek: boolean) {
  document.cookie = `${PEEK_COOKIE}=${peek ? 1 : 0}; path=/; max-age=${10 * 365 * 24 * 60 * 60}; SameSite=Lax`;
  window.dispatchEvent(new Event(EVENT));
}

// For useSyncExternalStore.
export function subscribeBoardPrefs(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}
