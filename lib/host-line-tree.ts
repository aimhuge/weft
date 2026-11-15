// A worker's synced folder over the session line (docs/architecture/folder-sync.md): the `tree` channel. Its first
// message must be an open this Mac signed for exactly that folder (lib/tree-sync-proof.ts); anything else, or a bad
// signature, gets `refused` and the channel closes. Once open, it's a peer (lib/tree-sync-peer.ts) on the folder's
// checkout, fed by a watcher, until the channel or the line closes.
import { createHash } from "node:crypto";
import { createPeer, type SyncPeer, type SyncStatus } from "./tree-sync-peer";
import { follower } from "./tree-sync-follow";
import { treeFs } from "./tree-sync-fs";
import { readSyncOpen, type SyncOpen } from "./tree-sync-proof";
import type { Channel } from "./worker-rtc";

export interface TreeDeps {
  // The folder's checkout and git dir once the open checks out; throws the refusal otherwise.
  allow(open: SyncOpen): Promise<{ dir: string; gitDir: string }>;
  self: { id: string; label: string };
  // How much this end counts in a clash: more while a thread runs in the folder.
  prio(dir: string): number;
  watch(dir: string, onPaths: (paths: string[]) => void): () => void;
  peer?: typeof createPeer;
}

type TreeChannel = Channel & { close?: () => void };
const reply = (channel: TreeChannel, message: Record<string, unknown>) => channel.send(JSON.stringify(message));

// A stable id for the Mac at the other end, from the key it signed with: its bases' file name here.
export const macIdOf = (key: string) => `mac-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;

// Handles one `tree` channel. Returns its stop, which the line calls when it closes.
export function treeChannel(channel: TreeChannel, deps: TreeDeps, log: (msg: string) => void = () => {}) {
  let state: "waiting" | "opening" | "open" | "done" = "waiting";
  let peer: SyncPeer | null = null;
  let unwatch = () => {};
  const current = () => state;
  const stop = () => {
    state = "done";
    unwatch();
    peer?.stop();
    peer = null;
  };
  const refuse = (message: string) => {
    reply(channel, { t: "refused", message: message.slice(0, 300) });
    stop();
    channel.close?.();
  };

  async function open(o: SyncOpen) {
    state = "opening";
    try {
      const { dir, gitDir } = await deps.allow(o);
      if (current() !== "opening") return;
      const made = (deps.peer ?? createPeer)({
        fs: treeFs(dir),
        self: deps.self,
        other: { id: macIdOf(o.mac.key), label: "your Mac" },
        send: (text) => channel.send(text),
        prio: () => deps.prio(dir),
        gitDir,
        // A commit on the Mac no longer leaves this checkout behind for good: it catches up (lib/tree-sync-follow.ts).
        follow: follower(dir, "your Mac"),
        log,
        onStatus: (s: SyncStatus) => s.kind === "paused" && log(`Weft Worker: sync of ${o.folder} paused: ${s.reason}`),
      });
      peer = made;
      state = "open";
      reply(channel, { t: "opened" });
      await made.start();
      // Closed while it started: stop() already ran, so no watcher may start after it.
      if (current() !== "open") return;
      unwatch = deps.watch(dir, (paths) => void made.touched(paths));
      log(`Weft Worker: syncing ${o.folder} over a line`);
    } catch (err) {
      if (current() !== "done") refuse((err as Error).message);
    }
  }

  channel.onMessage.subscribe((raw) => {
    const text = raw.toString();
    if (state === "open") return peer?.receive(text);
    if (state !== "waiting") return;
    const o = readSyncOpen(text);
    if (!o) { refuse("A synced folder opens with your Mac's signed request."); return; }
    void open(o);
  });
  channel.stateChanged.subscribe((s) => {
    if (s === "closed") stop();
  });
  return stop;
}
