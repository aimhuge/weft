import type { CloudSyncStatus } from "./cloud-sync-view";
import { timeAgo } from "./format";

// The avatar menu's Sync section (components/AccountSync.tsx) and the dot on the avatar (components/AccountButton.tsx):
// one line saying how board sync to weft.zip is going, and a tone that colours it. The full page is Settings → Sync.

export type SyncTone = "ok" | "busy" | "error" | "off";

export interface SyncLine {
  text: string;
  sub: string | null;
  tone: SyncTone;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export function syncLine(status: CloudSyncStatus, folders: string[], now: number): SyncLine {
  const count = folders.length ? `${plural(folders.length, "project")} sync to weft.zip` : null;
  if (status.signedOut) return { text: "Sign in to sync", sub: null, tone: "off" };
  if (status.noWorkspace) return { text: "No workspace yet", sub: "Open the web board to claim yours", tone: "off" };
  if (status.lastError) return { text: "Sync failed", sub: status.lastError, tone: "error" };
  if (!folders.length) return { text: "Sync is off", sub: "No project uploads its threads", tone: "off" };
  if (status.waiting > 0) return { text: `Syncing ${plural(status.waiting, "item")}…`, sub: count, tone: "busy" };
  if (status.lastSyncAt) return { text: `Synced ${timeAgo(status.lastSyncAt, now)}`, sub: count, tone: "ok" };
  return { text: "Not synced yet", sub: count, tone: "off" };
}

// The avatar shows a dot only when there's something to know: an upload under way, or one that failed. The tone never
// depends on the clock, so no `now` (Date.now() in a render is impure).
export function syncDot(status: CloudSyncStatus, folders: string[]): SyncTone | null {
  const { tone } = syncLine(status, folders, 0);
  return tone === "busy" || tone === "error" ? tone : null;
}

// One project's own line, for the project's right-click menu (lib/project-menu.ts). The flush is global
// (one outbox), so the times are the last flush's — but whether *this* project is syncing is its own:
// a project that isn't opted in is "Not Synced" however well the others are doing.
export function projectSyncLine(folder: string, status: CloudSyncStatus, folders: string[], now: number): SyncLine {
  if (!folders.includes(folder)) return { text: "Not Synced", sub: null, tone: "off" };
  if (status.signedOut) return { text: "Sign in to sync", sub: null, tone: "off" };
  if (status.noWorkspace) return { text: "No workspace yet", sub: null, tone: "off" };
  if (status.lastError) return { text: "Sync Failed", sub: status.lastError, tone: "error" };
  if (status.waiting > 0) return { text: "Syncing…", sub: null, tone: "busy" };
  if (status.lastSyncAt) return { text: `Synced ${timeAgo(status.lastSyncAt, now)}`, sub: null, tone: "ok" };
  return { text: "Not Synced", sub: null, tone: "off" };
}
