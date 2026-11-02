// A card one of the user's Weft Workers sent to another host (docs/architecture/project-hosts.md#board-tools-on-a-worker).
// worker_new_card rebuilds such a row's payload in the database and stamps it with `fromWorker`, the sending worker's
// id; the row is otherwise the user's own (created_by is the worker's owner), so the stamp is the only way the target
// tells it apart. A worker key belongs to a box, not to the user, and the prompt may be a thread's injected text, so
// the target never lets one run unasked: a Mac files it in Backlog for the user to start, a worker starts it in
// `default`, which asks before every edit and command. Only the database can write the stamp onto a worker's row; a
// user who adds it to their own row only holds their own card back.
export const WORKER_CARD_MODE = "default";
export const WORKER_CARD_TAG = "from-worker";

// The sending worker's id, or null for a row the user sent.
export function sentByWorker(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const id = (payload as { fromWorker?: unknown }).fromWorker;
  return typeof id === "string" && id ? id : null;
}

// A Mac's new card from a worker: Backlog, `default`, and tagged so the user sees where it came from.
export function holdWorkerCard(body: Record<string, unknown>): Record<string, unknown> {
  const tags: unknown[] = Array.isArray(body.tags) ? (body.tags as unknown[]).filter((t) => t !== WORKER_CARD_TAG) : [];
  return { ...body, permissionMode: WORKER_CARD_MODE, start: false, tags: [...tags, WORKER_CARD_TAG] };
}
