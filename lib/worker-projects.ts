// A Weft Worker publishing its projects' snapshots (docs/architecture/project-hosts.md, H4): reads are pushed, so the
// desktop board's header badges never wait on the worker. Each folder under the work root is measured
// (lib/project-snapshot.ts) and sent with worker_put_project:
//
// - on a change: a card changed, debounced, so a turn's burst of events is one pass;
// - on a timer, every few minutes, so a snapshot is never older than that while the worker is up;
// - never while a turn runs (measuring walks the tree; SOUL.md: speed first), unless the last pass is long past;
// - and a folder whose snapshot didn't change isn't sent again until REFRESH_MS has gone, so its row's age still says
//   the worker is there.
import type { ProjectSnapshot } from "./project-reads";

export const EVERY_MS = 5 * 60_000;
export const SETTLE_MS = 20_000;
export const REFRESH_MS = 10 * 60_000;

export interface ProjectPublisherDeps {
  folders(): string[];
  read(folder: string): ProjectSnapshot;
  put(folder: string, snapshot: ProjectSnapshot): Promise<unknown>;
  // No turn is running; a pass waits for this unless the last one is over REFRESH_MS old.
  idle(): boolean;
  log: (msg: string) => void;
  now?: () => number;
  everyMs?: number;
  settleMs?: number;
}

const sameReads = (a: ProjectSnapshot, b: ProjectSnapshot) => JSON.stringify({ ...a, at: 0 }) === JSON.stringify({ ...b, at: 0 });

export function createProjectPublisher(deps: ProjectPublisherDeps) {
  const now = deps.now ?? Date.now;
  const sent = new Map<string, { snapshot: ProjectSnapshot; at: number }>();
  let lastPass = 0;
  let passing = false;
  let settle: ReturnType<typeof setTimeout> | undefined;

  async function one(folder: string) {
    const snapshot = deps.read(folder);
    const last = sent.get(folder);
    if (last && sameReads(last.snapshot, snapshot) && now() - last.at < REFRESH_MS) return;
    await deps.put(folder, snapshot);
    sent.set(folder, { snapshot, at: now() });
  }

  // One pass over every folder. A failed folder is logged and tried again on the next pass.
  async function publish(): Promise<void> {
    if (passing || (!deps.idle() && now() - lastPass < REFRESH_MS)) return;
    passing = true;
    lastPass = now();
    for (const folder of deps.folders()) {
      try {
        await one(folder);
      } catch (err) {
        deps.log(`Weft Worker: publishing ${folder}: ${(err as Error).message}`);
      }
    }
    passing = false;
  }

  function changed() {
    clearTimeout(settle);
    settle = setTimeout(() => void publish(), deps.settleMs ?? SETTLE_MS);
  }

  function start(): () => void {
    void publish();
    const timer = setInterval(() => void publish(), deps.everyMs ?? EVERY_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(settle);
    };
  }

  return { publish, changed, start };
}
