// Live reload of a worker card's open files over its session line (docs/architecture/project-hosts.md, H4): files.watch
// runs as any verb on the line does (the `host` kind's checks, remoteRefusal's read rule and lib/host-api/files.ts), and
// only once it has, this line watches that file and pushes { t: "file", cardId, path, hash } on its `events` channel when
// it changes. files.unwatch drops it. At most MAX_WATCHES a line, refused past that before the verb runs, and every
// watch stops when the line closes.
import type { HostCall, LineEvent } from "./host-line-protocol";

export const MAX_WATCHES = 32;
export const TOO_MANY_WATCHES = `A board watches at most ${String(MAX_WATCHES)} files on a worker at once. Close a tab or two.`;

// Watches one file of a card's folder, by the path files.watch checked, and calls back with its hash after each change
// (null once it's gone or can't be read). Returns the function that stops it.
export type WatchFile = (cardId: string, path: string, changed: (hash: string | null) => void) => () => void;

const keyOf = (args: Record<string, unknown>) => (typeof args.id === "string" && typeof args.path === "string" ? { id: args.id, path: args.path, key: `${args.id}\n${args.path}` } : null);

export function lineFileWatches(watch: WatchFile | undefined, push: (event: LineEvent) => void, max = MAX_WATCHES) {
  const watches = new Map<string, () => void>();
  return {
    // Before a verb runs: why it may not, or null.
    refusal(call: HostCall): string | null {
      const named = keyOf(call.args);
      return call.verb === "files.watch" && named && !watches.has(named.key) && watches.size >= max ? TOO_MANY_WATCHES : null;
    },
    // After a verb ran without error: a watch starts (once per file), an unwatch stops it.
    ran(call: HostCall) {
      const named = keyOf(call.args);
      if (!named) return;
      if (call.verb === "files.unwatch") {
        watches.get(named.key)?.();
        watches.delete(named.key);
      }
      if (call.verb !== "files.watch" || !watch || watches.has(named.key)) return;
      watches.set(named.key, watch(named.id, named.path, (hash) => push({ t: "file", cardId: named.id, path: named.path, hash })));
    },
    count: () => watches.size,
    closeAll() {
      watches.forEach((stop) => stop());
      watches.clear();
    },
  };
}
