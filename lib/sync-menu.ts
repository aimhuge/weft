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
