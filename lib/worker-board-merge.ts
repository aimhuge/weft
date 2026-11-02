// A changed-cards read of the workers' board (lib/worker-board.ts readWorkerBoard with `since`) laid over the last whole
// read. A whole read replaces everything, and is what notices a deleted card, so the hook makes one every few minutes.
import type { WorkerBoard } from "./worker-project";

export const FULL_READ_EVERY_MS = 5 * 60_000;

export function mergeBoard(prev: WorkerBoard, next: WorkerBoard): WorkerBoard {
  if (!next.delta) return next;
  const changed = new Set([...next.cards.map((c) => c.id), ...(next.removed ?? [])]);
  const paths = new Set(next.projects.map((p) => p.path));
  // A project the changed read leaves out keeps its row, with the status its worker has now.
  const kept = prev.projects
    .filter((p) => !paths.has(p.path))
    .map((p) => {
      const sibling = next.projects.find((n) => n.workerId === p.workerId);
      return sibling ? { ...p, status: sibling.status } : p;
    });
  return {
    signedIn: next.signedIn,
    projects: [...next.projects, ...kept].toSorted((a, b) => a.path.localeCompare(b.path)),
    cards: [...next.cards, ...prev.cards.filter((c) => !changed.has(c.id))],
    ...(next.asOf ? { asOf: next.asOf } : {}),
  };
}
