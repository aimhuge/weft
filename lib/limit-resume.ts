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
// The window is the plan's, and each CLI has its own plan (lib/plan-pools.ts): a card parked on Claude
// Code's 5-hour window resumes when Claude's window resets, and a puku card waiting on Puku's allowance
// is untouched by it.

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
  return resumeAll(parked, `Auto-resumed after ${KIND_LABEL[kind]} reset`, "reset", now);
}

// Finds every non-archived, needs_you card with rateLimitHit whose OWN model is one of the given
// models, and resumes it. This is the upgrade path: the user raised their plan, the models that
// were capped have room again, and every card parked on one of them is free to run.
//
// The card's model is the one that matters — a card on Sonnet was never parked by Opus's cap, and
// waking it would send a message the user never asked for.
export function resumeParkedOnModels(models: string[], now: number): number {
  if (!models.length) return 0;
  const wanted = models.map((m) => m.toLowerCase());
  const parked = listCards().filter(
    (c) => !c.archived && c.column === "needs_you" && c.rateLimitHit && c.model && wanted.includes(c.model.toLowerCase()),
  );
  return resumeAll(parked, "Auto-resumed after a plan upgrade", "upgrade", now);
}

// The shared body of the two resume paths: clear the parked state, say why, and replay the last
// user message. Busy cards are skipped (the user started a turn manually between the poll and now)
// so we don't double-send.
function resumeAll(
  parked: ReturnType<typeof listCards>,
  lastLine: string,
  reason: "reset" | "upgrade",
  now: number,
): number {
  let resumed = 0;
  for (const card of parked) {
    if (isBusy(card.id)) continue;
    const text = lastUserText(card.id);
    if (!text) continue;
    updateCard(card.id, { error: undefined, rateLimitHit: false, autoResumedAt: now, autoResumedReason: reason, lastLine });
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
