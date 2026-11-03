// A new thread in a worker project, on the board the moment you press Start: the board picks its card id
// (lib/worker-new-thread.ts takes it as `cardId`), draws the card from what the dialog sent, and the worker's own card
// takes its place when a read or the session line brings it (lib/use-worker-board.ts). Before, nothing showed until the
// worker had made the card and published it, a few seconds later. A refusal (an offline worker, say) takes it off again,
// and one the worker never publishes goes after PENDING_MS. A thread with an agent goes as a run, whose card the worker
// names: that one is matched by its project and prompt instead.
import type { NewCardInput } from "./client-api";
import type { Card } from "./types";
import { headline } from "./new-thread";

export const PENDING_MS = 2 * 60_000;

type Pending = { card: Card; byPrompt: boolean; timer: ReturnType<typeof setTimeout> };

const pending = new Map<string, Pending>();
const listeners = new Set<() => void>();
let snapshot: Card[] = [];

function changed() {
  snapshot = [...pending.values()].map((p) => p.card);
  for (const l of [...listeners]) l();
}

export function subscribePending(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function pendingSnapshot(): Card[] {
  return snapshot;
}

// The card the worker will make, as the board draws it until then.
export function pendingCard(id: string, input: NewCardInput, worker: string, now = Date.now()): Card {
  const prompt = input.prompt.trim();
  return {
    id,
    title: input.title || headline(prompt),
    prompt,
    cwd: input.cwd,
    backend: input.backend,
    permissionMode: input.permissionMode ?? "auto",
    ...(input.model ? { model: input.model } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
    ...(input.tags?.length ? { tags: input.tags } : {}),
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.isolated ? { isolated: true } : {}),
    column: input.start ? "running" : "backlog",
    lastLine: `Sending to ${worker}…`,
    createdAt: now,
    updatedAt: now,
  };
}

// Draw it now; it goes by itself after PENDING_MS if the worker's card never comes. `byPrompt` when the worker will
// name the card itself (a started thread with an agent goes as a run, lib/worker-new-thread.ts).
export function drawPending(card: Card, byPrompt = false) {
  dropPending(card.id, false);
  pending.set(card.id, { card, byPrompt, timer: setTimeout(() => dropPending(card.id), PENDING_MS) });
  changed();
}

// The worker answered with another id than the board's: look for its card by its project and prompt.
export function matchByPrompt(id: string) {
  const p = pending.get(id);
  if (!p || p.byPrompt) return;
  p.byPrompt = true;
  changed();
}

export function dropPending(id: string, announce = true) {
  const p = pending.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(id);
  if (announce) changed();
}

// By its first line, since files pasted with the prompt can add to the rest of it on the way.
const firstLine = (prompt: string | undefined) => (prompt ?? "").trim().split("\n")[0];

function arrived(card: Card, cards: Card[]): boolean {
  if (!pending.get(card.id)?.byPrompt) return cards.some((c) => c.id === card.id);
  return cards.some((c) => c.cwd === card.cwd && firstLine(c.prompt) === firstLine(card.prompt) && c.createdAt >= card.createdAt - PENDING_MS);
}

// The workers' cards just read: a pending card the worker has published is done.
export function settlePending(cards: Card[]) {
  const done = [...pending.values()].filter((p) => arrived(p.card, cards));
  for (const p of done) dropPending(p.card.id, false);
  if (done.length) changed();
}

// The workers' cards with the ones on their way: a pending card the read already has isn't drawn twice.
export function withPending(cards: Card[], drawn: Card[] = snapshot): Card[] {
  if (!drawn.length) return cards;
  const waiting = drawn.filter((card) => !arrived(card, cards));
  return waiting.length ? [...waiting, ...cards] : cards;
}
