// This Mac's end of a synced folder (docs/architecture/folder-sync.md): the peer runs here in the server, on this Mac's
// checkout of the worker's project, and the board window, which holds the session line, pumps texts between the
// worker's `tree` channel and here (lib/line-tree-sync.ts over /api/tree-sync):
//
//   open     main signs the channel's first message (electron/tree-sync-sign.cjs), only for a folder you turned sync on for
//   opened   the worker took it: the peer starts on this Mac's twin of the project and its watcher runs
//   in/out   texts from the channel go to the peer; the peer's go out through a long poll the window keeps open
//   close    the channel or the window went: the peer stops (its bases stay in .git for next time)
import { execFileSync } from "node:child_process";
import path from "node:path";
import { busyCards } from "./runner-state";
import { getCard } from "./store";
import { treeFs } from "./tree-sync-fs";
import { createPeer, type SyncPeer, type SyncStatus } from "./tree-sync-peer";
import { watchFolder } from "./tree-sync-watch";
import { macTwin } from "./worker-twin-mac";
import { folderPrio } from "./worker-tree-sync";
import { deviceId } from "./device-id";

// How long an `out` poll waits for something to send before it answers empty.
export const POLL_MS = 15_000;
// Texts held for a window that stopped polling, before the session is dropped.
const MAX_HELD = 4_000;
// "Move to <worker>": this Mac's version wins every clash of the next catch-up, above any worker's threads (BUSY_PRIO 2;
// the wire takes under 1000), until that catch-up is done or this long has passed without the line coming up.
export const LEAD_PRIO = 900;
export const LEAD_MS = 10 * 60_000;

export interface Target {
  workerId: string;
  folder: string;
  workerName?: string;
}

export interface MacSyncDeps {
  shell: (route: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  // This Mac's checkout of the worker's project, by its name. A name is a guess (lib/worker-twin.ts), but a checkout of
  // another repo can't be on the same commit, so the peer pauses before it writes anything there.
  twin: (t: Target) => string | null;
  self: () => { id: string; label: string };
  prio: (dir: string) => number;
  now?: () => number;
  watch: typeof watchFolder;
  peer: typeof createPeer;
  gitDir: (dir: string) => string;
}

interface Session {
  peer: SyncPeer;
  held: string[];
  waiting: (() => void) | null;
  status: SyncStatus;
  stop: () => void;
}

const keyOf = (t: Target) => `${t.workerId.toLowerCase()}/${t.folder}`;

export function createMacSync(deps: MacSyncDeps) {
  const sessions = new Map<string, Session>();
  const statuses = new Map<string, SyncStatus>();
  const leads = new Map<string, number>();
  const now = deps.now ?? Date.now;
  const leading = (k: string) => (leads.get(k) ?? 0) > now();

  function close(t: Target) {
    const s = sessions.get(keyOf(t));
    if (!s) return;
    sessions.delete(keyOf(t));
    s.stop();
    s.waiting?.();
  }

  return {
    // The channel's first message: this Mac's signed request for the folder. Throws when sync isn't on for it.
    async open(t: Target): Promise<string> {
      if (!deps.twin(t)) throw new Error(`This Mac has no checkout of ${t.folder} to sync with.`);
      const mac = await deps.shell("/tree-sync/sign", { workerId: t.workerId, folder: t.folder });
      return JSON.stringify({ t: "open", folder: t.folder, mac });
    },

    // The worker took the open: the peer starts here.
    async opened(t: Target): Promise<void> {
      close(t);
      const dir = deps.twin(t);
      if (!dir) throw new Error(`This Mac has no checkout of ${t.folder} to sync with.`);
      const k = keyOf(t);
      const session: Session = { peer: null as unknown as SyncPeer, held: [], waiting: null, status: { kind: "connecting" }, stop: () => {} };
      const peer = deps.peer({
        fs: treeFs(dir),
        self: deps.self(),
        other: { id: t.workerId.toLowerCase(), label: t.workerName ?? "your worker" },
        send: (text) => {
          if (session.held.length >= MAX_HELD) { close(t); return; }
          session.held.push(text);
          session.waiting?.();
        },
        prio: () => (leading(k) ? LEAD_PRIO : deps.prio(dir)),
        gitDir: deps.gitDir(dir),
        onStatus: (s) => {
          session.status = s;
          statuses.set(k, s);
          if (s.kind === "synced") leads.delete(k);
        },
      });
      session.peer = peer;
      sessions.set(k, session);
      await peer.start();
      const unwatch = deps.watch(dir, (paths) => void peer.touched(paths));
      session.stop = () => {
        unwatch();
        peer.stop();
        statuses.set(k, { kind: "paused", reason: "Not connected to the worker right now." });
      };
    },

    receive(t: Target, texts: string[]): void {
      const s = sessions.get(keyOf(t));
      if (!s) throw new Error("That folder isn't syncing right now.");
      texts.forEach((text) => s.peer.receive(text));
    },

    // What the peer has to send: at once if anything is held, else when something is or after `ms`.
    async out(t: Target, ms = POLL_MS): Promise<{ texts: string[]; status: SyncStatus | null }> {
      const s = sessions.get(keyOf(t));
      if (!s) return { texts: [], status: null };
      if (!s.held.length) {
        await new Promise<void>((done) => {
          const timer = setTimeout(done, ms);
          s.waiting = () => {
            clearTimeout(timer);
            s.waiting = null;
            done();
          };
        });
      }
      return { texts: s.held.splice(0), status: s.status };
    },

    // Move to <worker>: this Mac leads the next catch-up of the folder.
    lead(t: Target): void {
      leads.set(keyOf(t), now() + LEAD_MS);
    },

    close,
    status: (t: Target): SyncStatus | null => statuses.get(keyOf(t)) ?? null,
    count: () => sessions.size,
  };
}

const gitDirOf = (dir: string) => {
  try {
    return path.resolve(dir, execFileSync("git", ["rev-parse", "--git-dir"], { cwd: dir, encoding: "utf8" }).trim());
  } catch {
    return path.join(dir, ".git");
  }
};

let real: ReturnType<typeof createMacSync> | undefined;

// The server's one manager, on the real main, twins and folders.
export function macSync(): ReturnType<typeof createMacSync> {
  return (real ??= createMacSync({
    shell: async (route, body) => (await import("./browser-shell")).shell(route, body),
    twin: (t) => macTwin(`worker://${t.workerId}/${t.folder}`),
    self: () => ({ id: deviceId(), label: "Mac" }),
    prio: (dir) => folderPrio(dir, () => busyCards().flatMap((id) => getCard(id)?.cwd ?? [])),
    watch: watchFolder,
    peer: createPeer,
    gitDir: gitDirOf,
  }));
}

