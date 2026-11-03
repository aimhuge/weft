"use client";

// The editor's live reload for a worker's card (docs/architecture/project-hosts.md, H4): while the worker's session line
// is up, an open file is watched there (files.watch, lib/host-line-files.ts on the worker), and each `file` event on the
// line's `events` calls back with its hash, so the editor re-reads it under the same rule as a local file's stat poll
// (lib/use-open-file.ts: a clean tab reloads, unsaved edits get the conflict banner). Each time the line comes up
// (again), the watch is asked again and the hash it answers is passed on too, so a change made while no line watched
// still reloads. Without a line nothing is watched, as before: reopening the file reads it again.
import type { FileWatch } from "./files-source";
import type { SessionLine } from "./session-line";
import { lineFor, onLinesChange } from "./session-lines";

const hashOf = (result: unknown) => (result as { value?: { hash?: string | null } } | null)?.value?.hash;

export function lineWatch(workerId: string): FileWatch {
  return (cardId, path, changed) => {
    const args = { id: cardId, path };
    // The line the watch was asked on, while it stays up.
    let on: SessionLine | null = null;
    let offEvents = () => {};

    function sync() {
      const line = lineFor(workerId);
      const live = line?.up() ? line : null;
      if (live === on) return;
      offEvents();
      offEvents = () => {};
      on = live;
      if (!live) return;
      offEvents = live.onEvent((e) => {
        if (e.t === "file" && e.cardId === cardId && e.path === path) changed(e.hash);
      });
      live.call("files.watch", args).then(
        (result) => {
          const hash = hashOf(result);
          if (hash !== undefined && on === live) changed(hash);
        },
        () => {},
      );
    }

    sync();
    const offLines = onLinesChange(sync);
    return () => {
      offLines();
      offEvents();
      if (on?.up()) on.call("files.unwatch", args).catch(() => {});
      on = null;
    };
  };
}
