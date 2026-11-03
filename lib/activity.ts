import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { subscribe } from "./bus";
import type { ActivityEvent } from "./game";
import { globalSingleton } from "./global-singleton";
import { DATA_DIR, listCards } from "./store";
import type { BoardEvent, Card, Column } from "./types";

// The activity log behind streaks, XP and achievements (lib/game.ts): ~/.weft/activity.jsonl, one
// JSON event per line, append-only with a stable id per event, so when accounts come a sync can send
// what it hasn't yet. The first read fills it from the board's cards, so your history counts from day one.

export const ACTIVITY_FILE = path.join(DATA_DIR, "activity.jsonl");

interface Log {
  events: ActivityEvent[] | null;
  ids: Set<string>;
  // Each card's column and turn count as last seen, to tell what changed.
  seen: Map<string, { column: Column; turns: number }> | null;
  stop: (() => void) | null;
}

const log = () => globalSingleton<Log>("__weftActivity", () => ({ events: null, ids: new Set(), seen: null, stop: null }));

// What a card's history says happened, for cards the log never saw: when it was made, its turns (all
// on its last active day), and when it reached Done. Imported Claude Code sessions count too.
export function backfillEvents(cards: Card[]): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  for (const card of cards) {
    if (card.role === "copilot" || card.handedOff) continue;
    const base = { card: card.id, cwd: card.cwd };
    out.push({ ...base, id: `created:${card.id}`, at: card.createdAt, kind: "created", title: card.title });
    const last = card.lastActivity ?? card.updatedAt;
    if (card.turns || last > card.createdAt) {
      out.push({ ...base, id: `turns:${card.id}`, at: last, kind: "turn", turns: Math.max(1, card.turns ?? 1), cost: card.costUsd });
    }
    if (card.column === "done") {
      out.push({ ...base, id: `done:${card.id}`, at: card.updatedAt, kind: "done", cost: card.costUsd, title: card.title });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// The log less what cards handed to a worker logged before they were marked (their "created", the moment they were
// made): the worker's own card counts that run (lib/worker-activity.ts), so it isn't made twice.
export function withoutHandedOff(events: ActivityEvent[], cards: Card[]): ActivityEvent[] {
  const handed = new Set(cards.flatMap((c) => (c.handedOff ? [c.id] : [])));
  return handed.size ? events.filter((e) => !e.card || !handed.has(e.card)) : events;
}

function parse(text: string): ActivityEvent[] {
  return text.split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line) as ActivityEvent];
    } catch {
      return [];
    }
  });
}

function write(events: ActivityEvent[]) {
  if (!events.length) return;
  fs.mkdirSync(path.dirname(ACTIVITY_FILE), { recursive: true });
  fs.appendFileSync(ACTIVITY_FILE, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

export function readActivity(): ActivityEvent[] {
  const state = log();
  if (state.events) return state.events;
  const fresh = !fs.existsSync(ACTIVITY_FILE);
  const events = fresh ? [] : parse(fs.readFileSync(ACTIVITY_FILE, "utf8"));
  state.events = events;
  state.ids = new Set(events.map((e) => e.id));
  if (fresh) append(backfillEvents(listCards()));
  return state.events;
}

// Adds events the log doesn't have yet (by id).
export function append(events: ActivityEvent[]) {
  const state = log();
  if (!state.events) readActivity();
  const added = events.filter((e) => !state.ids.has(e.id));
  for (const e of added) {
    state.ids.add(e.id);
    state.events?.push(e);
  }
  write(added);
}

export function record(event: Omit<ActivityEvent, "id">) {
  append([{ ...event, id: randomUUID() }]);
}

// A plan limit a Weft thread ran into. One event per window when its reset is known, so every
// rejected request of a busy hour logs it once; lib/usage.ts distinctHits folds the rest.
export function recordLimit(limit: "five_hour" | "seven_day", at: number, card?: { id: string; cwd: string }, resetsAt?: number) {
  try {
    append([{ id: resetsAt ? `limit:${limit}:${resetsAt}` : randomUUID(), at, kind: "limit", limit, card: card?.id, cwd: card?.cwd }]);
  } catch (err) {
    console.warn("Couldn't write the activity log", err);
  }
}

// What one card change means for the log.
export function changeEvents(prev: { column: Column; turns: number } | undefined, card: Card, running: number, now: number): ActivityEvent[] {
  if (card.handedOff) return [];
  if (!prev) return backfillEvents([card]);
  const base = { card: card.id, cwd: card.cwd, at: now };
  const out: ActivityEvent[] = [];
  const turns = card.turns ?? 0;
  if (turns > prev.turns) out.push({ ...base, id: randomUUID(), kind: "turn", turns: turns - prev.turns, cost: card.costUsd });
  if (card.column === "running" && prev.column !== "running") out.push({ ...base, id: randomUUID(), kind: "start", running });
  if (card.column === "done" && prev.column !== "done") {
    out.push({ ...base, id: randomUUID(), kind: "done", cost: card.costUsd, title: card.title });
  }
  return out;
}

function onEvent(event: BoardEvent) {
  const seen = log().seen;
  if (!seen) return;
  if (event.type === "card_deleted") {
    seen.delete(event.id);
    return;
  }
  if (event.type !== "card" || event.card.role === "copilot") return;
  const { card } = event;
  const prev = seen.get(card.id);
  seen.set(card.id, { column: card.column, turns: card.turns ?? 0 });
  const running = [...seen.values()].filter((s) => s.column === "running").length;
  try {
    append(changeEvents(prev, card, running, Date.now()));
  } catch (err) {
    console.warn("Couldn't write the activity log", err);
  }
}

// Starts following the board (once per server process). Safe to call on every request.
export function trackActivity() {
  const state = log();
  if (state.stop) return;
  readActivity();
  const cards = listCards();
  // Cards that arrived while nothing was following the board: their history, once.
  append(backfillEvents(cards.filter((c) => !state.ids.has(`created:${c.id}`))));
  state.seen = new Map(cards.map((c) => [c.id, { column: c.column, turns: c.turns ?? 0 }]));
  state.stop = subscribe(onEvent);
}
