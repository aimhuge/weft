import { sendMessage, isBusy } from "./runner";
import { getThread, listCards, updateCard } from "./store";
import { samePool } from "./plan-pools";
import type { Backend } from "./types";
import type { LimitKind } from "./limit-chart";

// When the 15-minute limit poll (lib/limit-poll.ts) records a window transition from
// used >= 100 to <100 (lib/limit-history.ts recordLimits), this module fires: it finds
// every parked card on that PLAN and replays its last user message, exactly the
// way lib/backend-switch.ts does for a rateLimitHit card. The chip on the card and
// lastLine explain what happened. lib/limit-poll.ts wires the handler on startup.
//
// The window is the plan's, so every CLI on it is parked by the same reset: a puku card waiting on the
// account's 5-hour window resumes when the account's window resets, whoever reported the reading
// (lib/plan-pools.ts).

// Human-friendly window name for the card's lastLine.
const KIND_LABEL: Record<LimitKind, string> = { five_hour: "5-hour", seven_day: "weekly" };

// The last user message a card's thread still has, or undefined if there is none yet.
function lastUserText(cardId: string): string | undefined {
  for (let i = getThread(cardId).length - 1; i >= 0; i--) {
    const item = getThread(cardId)[i];
    if (item?.kind === "user") return item.text;
  }
  return undefined;
}

// Finds every non-archived, needs_you card with rateLimitHit on the given plan, clears
// the rate-limit flag, marks autoResumedAt, updates lastLine, and replays the last user
// message. Skips busy cards (the user started a turn manually between the poll and now)
// so we don't double-send. Returns how many cards were resumed.
export function resumeParkedCards(backend: Backend, kind: LimitKind, now: number): number {
  const parked = listCards().filter((c) => !c.archived && c.column === "needs_you" && c.rateLimitHit && samePool(c.backend, backend));
  let resumed = 0;
  for (const card of parked) {
    if (isBusy(card.id)) continue;
    const text = lastUserText(card.id);
    if (!text) continue;
    updateCard(card.id, { error: undefined, rateLimitHit: false, autoResumedAt: now, lastLine: `Auto-resumed after ${KIND_LABEL[kind]} reset` });
    try {
      sendMessage(card.id, text, { echo: false });
      resumed += 1;
    } catch {
      // The card might have been deleted mid-loop, or the session might have closed; leave
      // the cleared state in place and let the next cycle try again if the rate limit hits.
    }
  }
  return resumed;
}
