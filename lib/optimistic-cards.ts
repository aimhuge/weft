import { api } from "./client";
import type { Card } from "./types";

// Delete, Stop and a permission prompt's answers land on the board at once, before the server answers. A delete
// can take a while (the DELETE route ends the card's CLI first) and a stop up to the runner's grace period, so the
// card used to sit there looking untouched, and a prompt stayed up until the server's event came back, so you
// clicked This first again. Every Delete and Stop button calls removeNow / stopNow here, every Allow, Deny, Wait and
// This first answerNow / waitNow / firstNow; the board
// (lib/board-live.ts) draws each card through `overlay`, so a server event that arrives mid-flight (the
// stopped turn's last update, a deleted card's final result) doesn't put the old state back. A failed
// call drops the intent and asks the board to reload, which brings back what the server really has.
// answer: the prompt pendingId was answered (allow), or set waiting (wait).
type Intent = { kind: "delete" } | { kind: "stop" } | { kind: "answer"; pendingId: string; allow: boolean; wait: boolean };
export type OptimisticUpdate = { kind: "apply" } | { kind: "reload" };

const intents = new Map<string, Intent>();
const listeners = new Set<(update: OptimisticUpdate) => void>();
// A stop (or an answer) the server said yes to but whose card never caught up (no session to stop, say) gives up
// after this long and reloads, so the card can't stay drawn that way for good.
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
// out of Running in Review, where a stopped turn ends (lib/turn.ts columnAfterTurn). An answered prompt is
// drawn as the runner leaves it (lib/runner-pending.ts settle, lib/permission-wait.ts startWaiting).
function shown(card: Card, intent: Intent | undefined): Card | null {
  if (!intent) return card;
  if (intent.kind === "delete") return null;
  if (intent.kind === "answer") return answered(card, intent);
  return { ...card, column: card.column === "running" ? "review" : card.column, pending: null, lastLine: "Stopped" };
}

function answered(card: Card, intent: Extract<Intent, { kind: "answer" }>): Card {
  const p = card.pending;
  if (p?.id !== intent.pendingId) return card;
  const holder = p.why?.holder;
  if (intent.wait) return { ...card, column: "running", pending: { ...p, waiting: true }, lastLine: holder ? `Waiting for ‘${holder.title}’` : card.lastLine };
  return { ...card, column: card.column === "needs_you" ? "running" : card.column, pending: null, lastLine: `${intent.allow ? "Allowed" : "Denied"}: ${p.title}` };
}

// Whether the server's card already shows what an intent draws, so the intent is done.
function caughtUp(card: Card, intent: Intent): boolean {
  if (intent.kind === "stop") return card.column !== "running" && !card.pending;
  if (intent.kind !== "answer") return false;
  return card.pending?.id !== intent.pendingId || (intent.wait && Boolean(card.pending.waiting));
}

// Field changes (star, archive, tags, rename, permission mode) drawn on a card until the server's card shows
// them. A second change to the same card merges in and bumps seq, so an older call's timeout leaves it alone.
const patches = new Map<string, { fields: Partial<Card>; seq: number }>();

// false, null, undefined and [] all read as unset, so { starred: false } matches a card with no starred field.
const norm = (v: unknown) => (v === false || v == null || (Array.isArray(v) && !v.length) ? "" : JSON.stringify(v));

function patched(card: Card, settleCaughtUp: boolean): Card {
  const patch = patches.get(card.id);
  if (!patch) return card;
  const done = Object.entries(patch.fields).every(([k, v]) => norm(card[k as keyof Card]) === norm(v));
  if (done && settleCaughtUp) {
    patches.delete(card.id);
    return card;
  }
  return { ...card, ...patch.fields };
}

const settlePatch = (id: string, seq: number, failed: boolean) => {
  if (patches.get(id)?.seq !== seq) return;
  patches.delete(id);
  if (failed) emit({ kind: "reload" });
};

// Change a card's own fields now and send `call`; a refusal drops the change and reloads.
export function patchNow(id: string, fields: Partial<Card>, call: () => Promise<unknown>): Promise<void> {
  const seq = (patches.get(id)?.seq ?? 0) + 1;
  patches.set(id, { fields: { ...patches.get(id)?.fields, ...fields }, seq });
  emit({ kind: "apply" });
  return call().then(
    () => {
      setTimeout(() => settlePatch(id, seq, true), STOP_SETTLE_MS);
    },
    (err: unknown) => {
      settlePatch(id, seq, true);
      throw err;
    },
  );
}

// A card from the server, as the board shows it. One the server already shows as no longer live has
// caught up, so its stop is done. Only for server cards: the board's own copy is already overlaid.
export function overlay(serverCard: Card): Card | null {
  const card = patched(serverCard, true);
  const intent = intents.get(card.id);
  if (intent && caughtUp(card, intent)) {
    intents.delete(card.id);
    return card;
  }
  return shown(card, intent);
}

// The server's whole list (a reload), through overlay.
export function overlayAll(cards: Card[]): Card[] {
  if (!intents.size && !patches.size) return cards;
  return cards.flatMap((c) => overlay(c) ?? []);
}

// The board's current cards with the open intents drawn on them, for the moment a button is pressed.
export function applyIntents(cards: Card[]): Card[] {
  if (!intents.size && !patches.size) return cards;
  return cards.flatMap((c) => shown(patched(c, false), intents.get(c.id)) ?? []);
}

// Delete a card: gone from the board now, back (by reload) if the server refuses.
export function removeNow(id: string): Promise<void> {
  const intent: Intent = { kind: "delete" };
  intents.set(id, intent);
  emit({ kind: "apply" });
  return api.remove(id).then(
    () => settle(id, intent, false),
    (err: unknown) => {
      settle(id, intent, true);
      throw err;
    },
  );
}

// Draw the intent now and send the call; once the server says yes, its own update takes over (or, if it never
// comes, a reload after STOP_SETTLE_MS). A refusal drops the intent and reloads.
function sendNow(id: string, intent: Intent, call: () => Promise<unknown>): Promise<void> {
  intents.set(id, intent);
  emit({ kind: "apply" });
  return call().then(
    () => {
      setTimeout(() => settle(id, intent, true), STOP_SETTLE_MS);
    },
    (err: unknown) => {
      settle(id, intent, true);
      throw err;
    },
  );
}

// Stop a card's turn: out of Running now; the server's own update takes over when the turn ends.
export function stopNow(id: string): Promise<void> {
  return sendNow(id, { kind: "stop" }, () => api.stop(id));
}

// Answer a prompt (Allow or Deny, or a folder grant's allow): it leaves the card now. `call` sends the answer.
export function answerNow(id: string, pendingId: string, allow: boolean, call: () => Promise<unknown>): Promise<void> {
  return sendNow(id, { kind: "answer", pendingId, allow, wait: false }, call);
}

// Wait on an edit another card holds: the card shows it waiting now (lib/permission-wait.ts).
export function waitNow(id: string, pendingId: string): Promise<void> {
  return sendNow(id, { kind: "answer", pendingId, allow: false, wait: true }, () => api.waitPermission(id, pendingId));
}

// This first: the edit goes ahead now (lib/precedence.ts).
export function firstNow(id: string, pendingId: string): Promise<void> {
  return sendNow(id, { kind: "answer", pendingId, allow: true, wait: false }, () => api.putFirst(id, pendingId));
}

// Others first: the card holding the code goes ahead and this card waits for it (lib/precedence.ts).
export function otherFirstNow(id: string, pendingId: string): Promise<void> {
  return sendNow(id, { kind: "answer", pendingId, allow: false, wait: true }, () => api.putHolderFirst(id, pendingId));
}

// The server deleted the card (its card_deleted event): nothing left to hold.
export function forget(id: string) {
  intents.delete(id);
  patches.delete(id);
}
