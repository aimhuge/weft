import { randomUUID } from "node:crypto";
import { restartArmed } from "./restart-when-idle";
import { addScheduled } from "./schedule";
import { sessions } from "./runner-state";
import { maxThreads } from "./settings";
import { getCard, listCards, updateCard } from "./store";
import { COPILOT_ID, type Card } from "./types";

// A cap on the threads running a turn at once. A dozen Claude Code threads building and testing at once slow
// the Mac to a crawl and spend the plan's window in minutes, so past `maxThreads()` a turn that would start waits
// on its card, the way a message waits for a restart (lib/restart-when-idle.ts): a scheduled message marked
// `forSlot`. When a turn ends (lib/runner.ts), a poll (lib/scheduler.ts) or a raised cap (app/api/settings)
// frees a slot, the oldest waiting message goes out first.
//
// What counts as running: a turn in progress, except a thread parked on a question or permission only you can
// answer (it uses no CPU and would otherwise block the queue until you looked) and the copilot (not a card).
// Answering such a thread can briefly put the count over the cap; nothing is interrupted.

// Threads running a turn now, not counting `except`.
export function runningCount(except?: string): number {
  let n = 0;
  for (const [id, session] of sessions) {
    if (id === COPILOT_ID || id === except || !session.busy || session.pending.length) continue;
    n += 1;
  }
  return n;
}

// Whether a turn for this card has to wait for a slot.
function full(cardId: string): boolean {
  const max = maxThreads();
  return max > 0 && runningCount(cardId) >= max;
}

export function slotNote(): string {
  return `Waiting for a free slot (${maxThreads()} threads running)`;
}

// Holds a message that would start a turn past the cap, on its card. False when it can go now. A card that is
// mid-turn is left alone: its message is steered or queued by the caller, or refused.
export function holdForSlot(cardId: string, text: string, { echo = true } = {}): boolean {
  const card = getCard(cardId);
  if (!card || card.role === "copilot" || sessions.get(cardId)?.busy || !full(cardId)) return false;
  const held = { id: randomUUID(), text, at: Date.now(), forSlot: true, ...(echo ? {} : { quiet: true }) };
  updateCard(cardId, { scheduled: addScheduled(card.scheduled, held), lastLine: slotNote() });
  return true;
}

// Whether a message of this card is waiting for a slot, so a /done wrap-up that is held isn't taken for finished.
export function waitingForSlot(cardId: string): boolean {
  return Boolean(getCard(cardId)?.scheduled?.some((m) => m.forSlot));
}

// The cards waiting for a slot, each with the message it has waited longest with, oldest first.
function waiting(): { card: Card; id: string; text: string; quiet?: boolean }[] {
  const list: { card: Card; id: string; text: string; at: number; quiet?: boolean }[] = [];
  for (const card of listCards()) {
    const held = card.scheduled?.find((m) => m.forSlot);
    if (held) list.push({ card, id: held.id, text: held.text, at: held.at, quiet: held.quiet });
  }
  return list.sort((a, b) => a.at - b.at);
}

// Sends the waiting messages that fit under the cap now; how many went. `send` is the runner's sendMessage, passed in
// so this module doesn't import it back. A held restart sends nothing: what is waiting goes after it.
export function releaseSlots(send: (cardId: string, text: string, opts: { echo: boolean }) => void): number {
  if (restartArmed()) return 0;
  let sent = 0;
  for (const { card, id, text, quiet } of waiting()) {
    if (full(card.id)) break;
    if (sessions.get(card.id)?.busy) continue;
    const rest = (getCard(card.id)?.scheduled ?? []).filter((m) => m.id !== id);
    updateCard(card.id, { scheduled: rest.length ? rest : undefined });
    try {
      send(card.id, text, { echo: !quiet });
      sent += 1;
    } catch (err) {
      updateCard(card.id, { error: `A thread that waited for a slot couldn't start: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
  return sent;
}
