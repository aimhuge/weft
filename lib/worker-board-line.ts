"use client";

// The workers' board over their session lines (docs/architecture/project-hosts.md, H1). While every worker the board
// shows has a live line, its cards' changes arrive as the line's `events`, so the 5 s read stretches to the idle one;
// as a line comes up the board takes a whole snapshot over it (card.list, answered with what the worker publishes,
// lib/worker-reads.ts), so nothing changed between the last read and the first event is missed.
import { askFiles } from "./worker-files";
import { lineFor } from "./session-lines";
import type { Card } from "./types";
import { workerProjectPath, type WorkerBoard, type WorkerProject } from "./worker-project";

export type CardSnapshot = { cards: { card: Card; folder: string }[] };

// Whether every worker among the board's projects has a live line. False for no projects: nothing to stretch.
export function allOnLines(projects: readonly Pick<WorkerProject, "workerId">[], up: (workerId: string) => boolean): boolean {
  const workers = new Set(projects.map((p) => p.workerId));
  return workers.size > 0 && [...workers].every(up);
}

export const lineUp = (workerId: string) => lineFor(workerId)?.up() ?? false;

// A worker's snapshot laid over the board's cards: each card in a project the board knows, with that project's path
// (as the read gives it), replacing the card the board had or joining it. Nothing is dropped: a deleted card leaves on
// its line event, or on the next whole read.
export function withSnapshot(board: WorkerBoard, workerId: string, snapshot: CardSnapshot): WorkerBoard {
  const known = new Set(board.projects.filter((p) => p.workerId === workerId).map((p) => p.path));
  const theirs = snapshot.cards.map(({ card, folder }) => ({ ...card, cwd: workerProjectPath(workerId, folder) })).filter((c) => known.has(c.cwd));
  const ids = new Set(theirs.map((c) => c.id));
  return { ...board, cards: [...board.cards.filter((c) => !ids.has(c.id)), ...theirs] };
}

// card.list over the worker's line, its value inline or from the blob store. Null when the line isn't up or it failed:
// the reads go on as they were.
export async function readSnapshot(workerId: string): Promise<CardSnapshot | null> {
  const line = lineFor(workerId);
  if (!line?.up()) return null;
  try {
    const snapshot = await askFiles<CardSnapshot | undefined>("card.list", { id: "" }, (verb, args) => line.call(verb, args));
    return Array.isArray(snapshot?.cards) ? snapshot : null;
  } catch {
    return null;
  }
}
