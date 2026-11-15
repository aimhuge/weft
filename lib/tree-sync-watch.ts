// A synced folder's watcher (docs/architecture/folder-sync.md): the repo-relative paths that changed, batched over
// BATCH_MS so a thread writing ten files sends one batch. Recursive fs.watch (macOS FSEvents, Linux inotify on Node 20+);
// .git's own churn is dropped, and the peer's periodic rescan catches anything a watcher misses.
import { watch as fsWatch } from "node:fs";

export const BATCH_MS = 150;

type Watch = (dir: string, opts: { recursive: true }, fn: (event: string, file: string | Buffer | null) => void) => { close(): void; on?(e: "error", fn: (err: Error) => void): unknown };

export function watchFolder(dir: string, onPaths: (paths: string[]) => void, watch: Watch = fsWatch, batchMs = BATCH_MS): () => void {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    const paths = [...pending];
    pending.clear();
    if (paths.length) onPaths(paths);
  };
  const watcher = watch(dir, { recursive: true }, (_event, file) => {
    if (!file) return;
    const p = String(file).split("\\").join("/");
    if (p === ".git" || p.startsWith(".git/") || /(^|\/)\.weft-sync-[0-9a-f]+$/.test(p)) return;
    pending.add(p);
    timer ??= setTimeout(flush, batchMs);
  });
  // A folder removed under the watcher, or too many to watch: the rescan still covers it.
  watcher.on?.("error", () => {});
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
