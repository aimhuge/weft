// A Weft Worker's side of synced folders (docs/architecture/folder-sync.md): what lib/host-line-tree.ts needs, from the
// worker's own home. A folder opens only when the request is signed by a Mac this box pinned (lib/tree-sync-proof.ts)
// and names one of the projects under its work root.
import path from "node:path";
import type { TreeDeps } from "./host-line-tree";
import { busyCards } from "./runner-state";
import { getCard } from "./store";
import { openRefusal } from "./tree-sync-proof";
import { watchFolder } from "./tree-sync-watch";
import { fileNonceStore, nonceBook } from "./widen-nonces";
import { workRoot } from "./worker-config";
import { listProjectFolders } from "./worker-folders";
import { macKeysAt } from "./worker-mac-keys";
import { repoPath } from "./worker-paths";

// Threads running in a folder make its version count for more in a clash.
export const BUSY_PRIO = 2;
export const IDLE_PRIO = 1;

export function folderPrio(dir: string, busy: () => string[] = () => busyCards().flatMap((id) => getCard(id)?.cwd ?? [])): number {
  return busy().some((cwd) => cwd === dir || cwd.startsWith(dir + path.sep)) ? BUSY_PRIO : IDLE_PRIO;
}

export function workerTreeDeps(o: { home: string; workerId: string; name: string; env?: NodeJS.ProcessEnv }): TreeDeps {
  const macs = macKeysAt(o.home);
  const nonces = nonceBook(fileNonceStore(path.join(o.home, "tree-nonces.json")));
  const root = workRoot(o.home, o.env ?? process.env);
  return {
    self: { id: o.workerId, label: o.name },
    async allow(open) {
      const refused = await openRefusal(open, { workerId: o.workerId, macKeys: () => macs.pinned(), nonces });
      if (refused) throw new Error(refused);
      if (!listProjectFolders(root).includes(open.folder)) throw new Error(`${open.folder} isn't a project on this worker.`);
      const dir = repoPath(root, open.folder);
      return { dir, gitDir: path.join(dir, ".git") };
    },
    prio: (dir) => folderPrio(dir),
    watch: (dir, onPaths) => watchFolder(dir, onPaths),
  };
}
