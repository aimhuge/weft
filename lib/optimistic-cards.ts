import { api } from "./client";
import type { Card } from "./types";

// Delete and Stop land on the board at once, before the server answers. A delete can take a while (the
// DELETE route ends the card's CLI first) and a stop up to the runner's grace period, so the card used to
// sit there looking untouched. Every Delete and Stop button calls removeNow / stopNow here; the board
// (lib/board-live.ts) draws each card through `overlay`, so a server event that arrives mid-flight (the
// stopped turn's last update, a deleted card's final result) doesn't put the old state back. A failed
// call drops the intent and asks the board to reload, which brings back what the server really has.
type Intent = "delete" | "stop";
export type OptimisticUpdate = { kind: "apply" } | { kind: "reload" };

const intents = new Map<string, Intent>();
const listeners = new Set<(update: OptimisticUpdate) => void>();
// A stop the server said yes to but whose card never left Running (no session to stop, say) gives up
// after this long and reloads, so the card can't stay drawn as stopped for good.
export const STOP_SETTLE_MS = 10_000;

function emit(update: OptimisticUpdate) {
  for (const l of [...listeners]) l(update);
}

// The board's way in: `apply` means redraw the cards through applyIntents, `reload` means fetch them.
export function onOptimistic(listener: (update: OptimisticUpdate) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function settle(id: string, intent: Intent, failed: boolean) {
  if (intents.get(id) !== intent) return;
  intents.delete(id);
  if (failed) emit({ kind: "reload" });
}

// How a card is drawn while an intent is open: null for one being deleted, and a stopping one already
// out of Running in Review, where a stopped turn ends (lib/turn.ts columnAfterTurn).
function shown(card: Card, intent: Intent | undefined): Card | null {
  if (!intent) return card;
  if (intent === "delete") return null;
  return { ...card, column: card.column === "running" ? "review" : card.column, pending: null, lastLine: "Stopped" };
}

// A card from the server, as the board shows it. One the server already shows as no longer live has
// caught up, so its stop is done. Only for server cards: the board's own copy is already overlaid.
export function overlay(card: Card): Card | null {
  const intent = intents.get(card.id);
  if (intent === "stop" && card.column !== "running" && !card.pending) {
    intents.delete(card.id);
    return card;
  }
  return shown(card, intent);
}

// The server's whole list (a reload), through overlay.
export function overlayAll(cards: Card[]): Card[] {
  if (!intents.size) return cards;
  return cards.flatMap((c) => overlay(c) ?? []);
}

// The board's current cards with the open intents drawn on them, for the moment a button is pressed.
export function applyIntents(cards: Card[]): Card[] {
  if (!intents.size) return cards;
  return cards.flatMap((c) => shown(c, intents.get(c.id)) ?? []);
}

// Delete a card: gone from the board now, back (by reload) if the server refuses.
export function removeNow(id: string): Promise<void> {
  intents.set(id, "delete");
  emit({ kind: "apply" });
  return api.remove(id).then(
    () => settle(id, "delete", false),
    (err: unknown) => {
      settle(id, "delete", true);
      throw err;
    },
  );
}

// Stop a card's turn: out of Running now; the server's own update takes over when the turn ends.
export function stopNow(id: string): Promise<void> {
  intents.set(id, "stop");
  emit({ kind: "apply" });
  return api.stop(id).then(
    () => {
      setTimeout(() => settle(id, "stop", true), STOP_SETTLE_MS);
    },
    (err: unknown) => {
      settle(id, "stop", true);
      throw err;
    },
  );
}

// The server deleted the card (its card_deleted event): nothing left to hold.
export function forget(id: string) {
  intents.delete(id);
}
