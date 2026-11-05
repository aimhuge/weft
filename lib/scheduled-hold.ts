import { randomUUID } from "node:crypto";
import { getCard, updateCard } from "./store";
import type { Card, ScheduledMessage } from "./types";

// The one place a message is held on a card: the restart waiting for the running turns, the card's own
// turn, the cap on running threads, or a time the user picked. Each caller says which, and this writes
// the same shape, so the flags on a held message live in one place.

export type HoldReason = "afterRestart" | "afterTurn" | "forSlot" | "timed";

export interface HoldOptions {
  reason: HoldReason;
  // A re-run of the last message (a retry or a limit resume): it is already in the thread, so it goes
  // out without an echo.
  quiet?: boolean;
  // The line the card shows while it waits (lib/thread-slots.ts).
  note?: string;
  // When the message is due; now, unless the caller picked a time.
  at?: number;
}

// The card's scheduled messages with this one added, soonest first.
export function addScheduled(list: ScheduledMessage[] | undefined, message: ScheduledMessage): ScheduledMessage[] {
  return [...(list ?? []), message].sort((a, b) => a.at - b.at);
}

// The flag a reason writes on the message; a timed message carries none, since its time says it all.
const flagOf = (reason: HoldReason) => (reason === "timed" ? undefined : reason);

// The message a hold writes on a card, with the flag its reason names.
export function holdMessage(card: Card, text: string, { reason, quiet = false, note, at = Date.now() }: HoldOptions): Card {
  const flag = flagOf(reason);
  const message: ScheduledMessage = { id: randomUUID(), text, at, ...(flag ? { [flag]: true } : {}) };
  if (quiet) message.quiet = true;
  return updateCard(card.id, { scheduled: addScheduled(card.scheduled, message), ...(note ? { lastLine: note } : {}) });
}

// Holds a message on a card, for a reason, with the card's current schedule.
export function hold(cardId: string, text: string, options: HoldOptions): Card {
  const card = getCard(cardId);
  if (!card) throw new Error("No such card.");
  return holdMessage(card, text, options);
}
