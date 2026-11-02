// The id the Mac gives a cron or webhook a Weft Worker published (lib/worker-lists-read.ts): `worker:<worker id>:<its
// id there>`, so the Mac can't mistake it for one of its own. The routes send a change to it as a host verb to that
// worker (lib/worker-list-acts.ts); the board waits WORKER_LIST_SETTLE_MS for the worker's republished list. Pure, so the
// board's hooks can read it too.
export const WORKER_ITEM = "worker:";

// The worker republishes its lists 2 s after a change (lib/worker-lists.ts PUBLISH_DELAY_MS); a little more for the write.
export const WORKER_LIST_SETTLE_MS = 3_500;

export const isWorkerItem = (id: string) => id.startsWith(WORKER_ITEM);

export const workerItemId = (workerId: string, id: string) => `${WORKER_ITEM}${workerId}:${id}`;

// The worker and the item's own id there, or null for this Mac's own (or a broken id).
export function parseWorkerItem(id: string): { workerId: string; id: string } | null {
  if (!isWorkerItem(id)) return null;
  const rest = id.slice(WORKER_ITEM.length);
  const cut = rest.indexOf(":");
  if (cut <= 0 || cut === rest.length - 1) return null;
  return { workerId: rest.slice(0, cut), id: rest.slice(cut + 1) };
}
