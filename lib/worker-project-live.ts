// A Weft Worker's new project snapshot, heard the moment it's written (docs/architecture/project-hosts.md, H4): this
// Mac's server subscribes to cloud_worker_projects over Realtime with the account's own session (RLS hands it only its
// workspace's rows), and tells the board through the event stream (`worker_project`), which drops that folder's cached
// snapshot so the header badges read it again (lib/project-snapshot-view.ts). The subscription starts with the first
// snapshot read (lib/worker-board-reads.ts), so a Mac that never shows a worker project holds nothing open.
//
// It degrades to the read it replaces: a database whose publication doesn't carry the table yet
// (supabase/migrations/20261103070100_worker_projects_realtime.sql) either errors the channel or sends nothing, and the
// badges keep reading on a turn's end, on focus and after their 15 s cache. A failed channel is tried again after RETRY_MS.
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { publish } from "./bus";
import { globalSingleton } from "./global-singleton";
import { workerProjectPath } from "./worker-project";

export const RETRY_MS = 5 * 60_000;

interface Live {
  channel: RealtimeChannel | null;
  org: string | null;
  retryAt: number;
  warned: boolean;
}

const live = () => globalSingleton<Live>("__weftWorkerProjectLive", () => ({ channel: null, org: null, retryAt: 0, warned: false }));

type Row = { worker_id?: unknown; folder?: unknown };

// The worker:// path a change is about: the new row, or the old one for a delete. Null when the event names neither.
export function projectOfChange(payload: { new?: Row | null; old?: Row | null }): string | null {
  const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
  if (!row || typeof row.worker_id !== "string" || typeof row.folder !== "string") return null;
  return workerProjectPath(row.worker_id, row.folder);
}

const FAILED = new Set(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]);

// Holds one subscription for the signed-in workspace. Called on every snapshot read: a no-op while it's up, and
// resubscribes after the workspace changed, or RETRY_MS after the channel failed.
export function watchWorkerProjects(client: SupabaseClient, org: string, now = Date.now()): void {
  const g = live();
  if (g.org === org && (g.channel || now < g.retryAt)) return;
  const old = g.channel;
  g.channel = null;
  if (old) void client.removeChannel(old).catch(() => {});
  g.org = org;
  const channel = client
    .channel(`worker-projects-${org}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "cloud_worker_projects", filter: `org_id=eq.${org}` }, (payload) => {
      const project = projectOfChange(payload);
      if (project) publish({ type: "worker_project", project });
    })
    .subscribe((status: string, err?: Error) => {
      if (!FAILED.has(status) || g.channel !== channel) return;
      g.channel = null;
      g.retryAt = Date.now() + RETRY_MS;
      void client.removeChannel(channel).catch(() => {});
      if (g.warned) return;
      g.warned = true;
      console.warn(`Worker projects: no live snapshots (${status}${err ? `: ${err.message}` : ""}); the badges read them on their own.`);
    });
  g.channel = channel;
}
