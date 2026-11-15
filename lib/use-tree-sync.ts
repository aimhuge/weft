// Keeps every folder this Mac syncs with a worker in sync while the board is open (docs/architecture/folder-sync.md):
// reads the list from main and holds a pipe per folder (lib/line-tree-sync.ts keepSynced), again whenever a project's
// "Keep in Sync with <worker>" changes it. Only in Weft's own desktop window: the web board has no checkout to sync.
import { useEffect, useState } from "react";
import { keepSynced, realPipeDeps, type SyncTarget } from "./line-tree-sync";
import { syncedFolders, TREE_SYNC_CHANGED } from "./tree-sync-menu";

export function useTreeSync(load: () => Promise<SyncTarget[]> = syncedFolders) {
  const [targets, setTargets] = useState<SyncTarget[]>([]);
  useEffect(() => {
    if (typeof window === "undefined" || !window.weft || typeof RTCPeerConnection === "undefined") return;
    let alive = true;
    const read = () => void load().then((t) => alive && setTargets(t));
    read();
    window.addEventListener(TREE_SYNC_CHANGED, read);
    return () => {
      alive = false;
      window.removeEventListener(TREE_SYNC_CHANGED, read);
    };
  }, [load]);
  const key = JSON.stringify(targets);
  useEffect(() => (targets.length ? keepSynced(targets, realPipeDeps()) : undefined), [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
