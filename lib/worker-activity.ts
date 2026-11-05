// Work done on your Weft Workers, for streaks, XP and badges (docs/architecture/gamification.md#work-on-a-worker): the
// cards your own workers published (lib/worker-board.ts readWorkerBoard reads only workers you enrolled), turned into the
// same events the activity log backfills a card with (lib/activity.ts backfillEvents): made, its turns, and Done. A card
// that ran across several days has its turns counted on each day one ended (lib/worker-turn-times.ts), so the streak
// sees every day a worker worked; a card that lived one day, or whose times can't be read, counts on its last active day. Not written to this Mac's log: they're read afresh, so a worker card that runs on counts its
// new turns, and the log stays this Mac's own.
//
// No double counting: an event id is the card's (created:<id>, turns:<id>[:<day>], done:<id>), and gameState drops any whose
// card or id this Mac's log already has (mergeWorkerEvents).
import { backfillEvents } from "./activity";
import { dayKey, type ActivityEvent } from "./game";
import type { Card } from "./types";

// The header chip asks often; the worker board is read at most this often for it.
export const WORKER_ACTIVITY_TTL = 5 * 60_000;

let cached: { at: number; events: Promise<ActivityEvent[]> } | null = null;

// A slow network never holds the game up for longer than this; the read carries on and the next ask has it.
export const WORKER_ACTIVITY_WAIT = 3_000;

type TurnTimes = (cardIds: string[]) => Promise<Map<string, number[]>>;
const noTimes: TurnTimes = () => Promise.resolve(new Map<string, number[]>());

// The cards whose turns could fall on more than one day: made on one day, last active on another.
export function multiDayCards(cards: Card[]): string[] {
  return cards.flatMap((c) => (c.role !== "copilot" && !c.handedOff && dayKey(c.createdAt) !== dayKey(c.lastActivity ?? c.updatedAt) ? [c.id] : []));
}

// A card's one backfilled turn event, split into one per day a turn ended. Turns the times don't account for (a read
// cut short, a turn with no result item) count on its last active day, so the total stays the card's own.
export function turnDays(event: ActivityEvent, times: readonly number[]): ActivityEvent[] {
  const days = new Map<string, { at: number; turns: number }>();
  for (const at of times) {
    const day = days.get(dayKey(at));
    days.set(dayKey(at), { at: Math.max(day?.at ?? at, at), turns: (day?.turns ?? 0) + 1 });
  }
  const lastDay = dayKey(event.at);
  const counted = [...days.values()].reduce((n, d) => n + d.turns, 0);
  const extra = Math.max(0, (event.turns ?? 1) - counted);
  if (extra) days.set(lastDay, { at: Math.max(days.get(lastDay)?.at ?? event.at, event.at), turns: (days.get(lastDay)?.turns ?? 0) + extra });
  const newest = Math.max(...[...days.values()].map((d) => d.at));
  // The card's total cost rides on its newest day only, as the one event carried it.
  const { cost, ...rest } = event;
  return [...days].map(([day, d]) => ({ ...rest, id: `${event.id}:${day}`, at: d.at, turns: d.turns, ...(d.at === newest && cost !== undefined ? { cost } : {}) }));
}

/** The worker cards' events, with a multi-day card's turns on each day they ended. */
export function workerEvents(cards: Card[], times: Map<string, number[]>): ActivityEvent[] {
  const events = backfillEvents(cards);
  if (!times.size) return events;
  return events
    .flatMap((e) => {
      const at = e.kind === "turn" ? times.get(String(e.card)) : undefined;
      return at?.length ? turnDays(e, at) : [e];
    })
    .sort((a, b) => a.at - b.at);
}

export function workerActivity(read: () => Promise<{ cards: Card[] }>, now = Date.now(), waitMs = WORKER_ACTIVITY_WAIT, turnTimes: TurnTimes = noTimes): Promise<ActivityEvent[]> {
  if (!cached || now - cached.at >= WORKER_ACTIVITY_TTL) {
    const events = read().then(
      async (board) => {
        const ids = multiDayCards(board.cards);
        const times = ids.length ? await turnTimes(ids).catch(() => new Map<string, number[]>()) : new Map<string, number[]>();
        return workerEvents(board.cards, times);
      },
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
