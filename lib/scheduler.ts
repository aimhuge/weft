import { restartArmed } from "./restart-when-idle";
import { freeSlots, isBusy, sendUserMessage } from "./runner";
import { holdMessage } from "./scheduled-hold";
import { dueMessage } from "./schedule";
import { prebakeBriefs } from "./splice";
import { startClock } from "./tick-clock";
import { getCard, listCards, updateCard } from "./store";
import { COPILOT_ID, type Card } from "./types";

export function scheduleMessage(cardId: string, text: string, at: number): Card {
  const card = getCard(cardId);
  if (!card) throw new Error("No such card.");
  if (cardId === COPILOT_ID) throw new Error("The copilot can't take a scheduled message.");
  if (!Number.isFinite(at)) throw new Error("Pick a time to send it.");
  if (at <= Date.now()) throw new Error("That time has already passed.");
  return holdMessage(card, text, { reason: "timed", at });
}

export function unscheduleMessage(cardId: string, messageId: string): Card {
  const card = getCard(cardId);
  if (!card) throw new Error("No such card.");
  const scheduled = (card.scheduled ?? []).filter((m) => m.id !== messageId);
  return updateCard(cardId, { scheduled: scheduled.length ? scheduled : undefined });
}

// Sends each card's due message, one per card per check. A card mid-turn waits for its turn to end.
export function sendDueMessages(now = Date.now()) {
  // A restart is waiting for the running turns to end; what's due goes out once Weft is back.
  if (restartArmed()) return;
  // Threads waiting for a slot go before the timed ones, so a turn that ended unseen doesn't strand them.
  freeSlots();
  for (const card of listCards()) {
    // The list is read once, so a card with nothing scheduled takes the same path as one with a due message.
    const scheduled = card.scheduled ?? [];
    const due = dueMessage(card, now);
    if (!due || isBusy(card.id)) continue;
    const rest = scheduled.filter((m) => m.id !== due.id);
    updateCard(card.id, { scheduled: rest.length ? rest : undefined });
    try {
      sendUserMessage(card.id, due.text);
    } catch (err) {
      updateCard(card.id, { error: `A scheduled message couldn't go: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
}

// Once per server process. How often the server looks for scheduled messages whose time has come.
// A Mac that slept past one sends it on the first check after waking; a Weft that was closed, on
// the first after starting.
export function startScheduler() {
  // The first check looks only for due messages; the briefs are baked after that, on the interval.
  startClock("schedule", () => {
    sendDueMessages();
    prebakeBriefs();
  }, { first: () => sendDueMessages() });
}
