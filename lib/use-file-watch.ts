"use client";

// An open file's pushed changes (lib/files-source.ts `watch`): a source that can't afford the editor's stat poll but can
// watch the file (a worker's, over its session line) calls back with the file's hash, and a hash other than the one
// loaded re-reads it and hands it to `onDisk`, the same rule the poll uses (lib/use-open-file.ts).
import { useEffect, type RefObject } from "react";
import type { OpenedFile } from "./client-files";
import type { FilesSource } from "./files-source";

export function useFileWatch(source: FilesSource, cardId: string, path: string, enabled: boolean, loaded: RefObject<OpenedFile | null>, onDisk: (next: OpenedFile) => void) {
  useEffect(() => {
    if (!enabled || !source.watch) return undefined;
    let stopped = false;
    const stop = source.watch(cardId, path, (hash) => {
      const cur = loaded.current;
      if (!cur || hash === cur.hash) return;
      source
        .read(cardId, path)
        .then((next) => {
          // Our own save may have landed while it read (its hash is now the loaded one): that's no change.
          if (!stopped && next.hash !== loaded.current?.hash) onDisk(next);
        })
        .catch(() => {});
    });
    return () => {
      stopped = true;
      stop();
    };
  }, [source, cardId, path, enabled, loaded, onDisk]);
}
