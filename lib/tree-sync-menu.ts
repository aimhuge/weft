// "Keep in Sync with <worker>" in a project's menu (docs/architecture/folder-sync.md): the worker projects that are this
// project on another machine, each checked when this Mac keeps it as one folder with the worker's checkout. Turning it
// on asks for Touch ID in main; turning it off doesn't. Either way the board's syncs reload (useTreeSync).
import { treeSyncApi, type SyncTarget } from "./line-tree-sync";
import { parseWorkerProject } from "./worker-project";

export const TREE_SYNC_CHANGED = "weft:tree-sync";

export interface SyncTwin {
  path: string;
  name: string;
  offline: boolean;
  on: boolean;
  // How a synced one stands when it isn't simply in sync: "Paused: …", "Connecting…".
  note?: string;
}

type Api = typeof treeSyncApi;

// The folders this Mac keeps in sync, as main lists them; none when main can't say (an older shell).
export async function syncedFolders(api: Api = treeSyncApi): Promise<SyncTarget[]> {
  const r = await api({ op: "list" }).catch(() => ({ folders: [] }));
  return Array.isArray(r.folders) ? (r.folders as SyncTarget[]) : [];
}

// Each worker twin of the project, marked on when it's synced.
export function syncTwins(twins: { path: string; name: string; offline: boolean }[], synced: SyncTarget[]): SyncTwin[] {
  return twins.flatMap((t) => {
    const w = parseWorkerProject(t.path);
    if (!w) return [];
    const on = synced.some((s) => s.workerId.toLowerCase() === w.workerId.toLowerCase() && s.folder === w.folder);
    return [{ ...t, on }];
  });
}

export const isTreeSync = (id: string): id is `sync-tree:${string}` => id.startsWith("sync-tree:");
export const isMoveTree = (id: string): id is `move-tree:${string}` => id.startsWith("move-tree:");

const targetOf = (twin: SyncTwin) => {
  const w = parseWorkerProject(twin.path);
  if (!w) throw new Error("That isn't a worker's project.");
  return { w, target: { workerId: w.workerId, folder: w.folder, workerName: twin.name } };
};

// A sync's state as one menu line; nothing while it's in sync, which the tick already says. A reason's list of files
// (in brackets at its end) stays in the log.
export function syncNote(status: unknown): string | undefined {
  const s = status as { kind?: string; reason?: string } | null;
  if (!s) return "Not connected right now";
  if (s.kind === "connecting") return "Connecting…";
  if (s.kind === "paused") return `Paused: ${(s.reason ?? "").replace(/ \([^)]*\)$/, "").replace(/\.$/, "")}`.slice(0, 110);
  return undefined;
}

// Each synced twin with its note, read from this Mac's peer. A failed read leaves the twin as it was.
export function withNotes(twins: SyncTwin[], api: Api = treeSyncApi): Promise<SyncTwin[]> {
  return Promise.all(
    twins.map(async (twin) => {
      if (!twin.on) return twin;
      const { target } = targetOf(twin);
      const note = await api({ op: "status", ...target }).then((r) => syncNote(r.status), () => undefined);
      return note ? { ...twin, note } : twin;
    }),
  );
}

// "Move to <worker>": this Mac's uncommitted work goes to the worker, this Mac winning every clash of that first
// catch-up (the worker keeps its own as .conflict- copies), and the folder stays in sync after. The caller then ticks
// Run on Worker; cards open here stay here.
export async function moveToWorker(twin: SyncTwin, api: Api = treeSyncApi, notify: () => void = () => window.dispatchEvent(new Event(TREE_SYNC_CHANGED))): Promise<string> {
  const { w, target } = targetOf(twin);
  await api({ op: "lead", ...target });
  if (!twin.on) await api({ op: "enable", ...target });
  notify();
  return `Sending ${w.folder}'s uncommitted work to ${twin.name}; it stays in sync, and new threads start there.`;
}

// Turns sync of one worker twin on (Touch ID) or off; returns the toast.
export async function toggleTreeSync(twin: SyncTwin, api: Api = treeSyncApi, notify: () => void = () => window.dispatchEvent(new Event(TREE_SYNC_CHANGED))): Promise<string> {
  const { w, target } = targetOf(twin);
  await api({ op: twin.on ? "disable" : "enable", ...target });
  notify();
  return twin.on
    ? `${w.folder} no longer syncs with ${twin.name}. Each keeps its files as they are now.`
    : `${w.folder} now syncs with ${twin.name} while Weft is open: changes on either side reach the other in a second or two.`;
}
