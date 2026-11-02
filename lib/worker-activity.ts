// Work done on your Weft Workers, for streaks, XP and badges (docs/architecture/gamification.md#work-on-a-worker): the
// cards your own workers published (lib/worker-board.ts readWorkerBoard reads only workers you enrolled), turned into the
// same events the activity log backfills a card with (lib/activity.ts backfillEvents): made, its turns on its last
// active day, and Done. Not written to this Mac's log: they're read afresh, so a worker card that runs on counts its
// new turns, and the log stays this Mac's own.
//
// No double counting: an event id is the card's (created:<id>, turns:<id>, done:<id>), and gameState drops any whose
// card or id this Mac's log already has (mergeWorkerEvents).
import { backfillEvents } from "./activity";
import type { ActivityEvent } from "./game";
import type { Card } from "./types";

// The header chip asks often; the worker board is read at most this often for it.
export const WORKER_ACTIVITY_TTL = 5 * 60_000;

let cached: { at: number; events: Promise<ActivityEvent[]> } | null = null;

// A slow network never holds the game up for longer than this; the read carries on and the next ask has it.
export const WORKER_ACTIVITY_WAIT = 3_000;

export function workerActivity(read: () => Promise<{ cards: Card[] }>, now = Date.now(), waitMs = WORKER_ACTIVITY_WAIT): Promise<ActivityEvent[]> {
  if (!cached || now - cached.at >= WORKER_ACTIVITY_TTL) {
    const events = read().then(
      (board) => backfillEvents(board.cards),
      () => [],
    );
    cached = { at: now, events };
  }
  const { events } = cached;
  return Promise.race([events, new Promise<ActivityEvent[]>((resolve) => setTimeout(() => resolve([]), waitMs).unref())]);
}

export function forgetWorkerActivity() {
  cached = null;
}

/** This Mac's events plus the workers' ones it doesn't already have, by event id or card. */
export function mergeWorkerEvents(local: ActivityEvent[], remote: ActivityEvent[]): ActivityEvent[] {
  if (!remote.length) return local;
  const ids = new Set(local.map((e) => e.id));
  const cards = new Set(local.flatMap((e) => (e.card ? [e.card] : [])));
  const extra = remote.filter((e) => !ids.has(e.id) && !(e.card && cards.has(e.card)));
  return extra.length ? [...local, ...extra].sort((a, b) => a.at - b.at) : local;
}
