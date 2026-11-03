// The worker's side of the editor's live reload (lib/host-line-files.ts): a stat poll on each file a line watches, once a
// second, and its hash after each change. A stat poll rather than fs.watch, so a file an agent or an editor replaces
// (write to a temp file, then rename) is still the one watched. The read goes through lib/file-access.ts, the same
// folder confinement as files.read; a card that's gone, or a read refused, reads as null.
import fs from "node:fs";
import path from "node:path";
import { readFile } from "./file-access";
import type { WatchFile } from "./host-line-files";

export const WATCH_INTERVAL_MS = 1_000;

export function watchCardFiles(cwdOf: (cardId: string) => string | undefined, interval = WATCH_INTERVAL_MS): WatchFile {
  return (cardId, file, changed) => {
    const cwd = cwdOf(cardId);
    if (!cwd) return () => {};
    const abs = path.resolve(cwd, file);
    const listener = () => {
      const now = cwdOf(cardId);
      const read = now ? readFile(now, file).then((f) => f.hash) : Promise.resolve(null);
      void read.catch(() => null).then(changed);
    };
    fs.watchFile(abs, { interval, persistent: false }, listener);
    return () => fs.unwatchFile(abs, listener);
  };
}
