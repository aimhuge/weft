// Re-pointing a card that is already running: the one rule for changing a thread's identity
// (its CLI, its agent, later its model or its folder) under it.
//
// The rule is the same every time — refuse while a turn is running, end the CLI's session, then
// patch the card — and the order matters: ending the session settles the turn, and the card's
// session id and stats can be written back as it winds down, so the patch comes after it. A patch
// that clears them (a new CLI starts a fresh session) has to win.
//
// The busy check and the ending come from the caller, so each caller keeps the runner it already
// reaches for: the API's card route ends through lib/runner.ts, and lib/backend-switch.ts through
// lib/runner-state.ts's hooks.

import { updateCard } from "./store";
import type { Card } from "./types";

export interface RepointRunner {
  // Whether the card's thread is running a turn right now.
  isBusy: (cardId: string) => boolean;
  // Ends the card's CLI session: the next turn starts a fresh one, under the new identity.
  endSession: (cardId: string) => Promise<void>;
}

// Re-points a card: refuses while a turn is running, ends the session, then patches the card.
// `refused` is the message the caller shows — each kind of re-point says its own ("…before
// switching its CLI.", "…before switching its agent.").
export async function repointCard(card: Card, patch: Partial<Card>, refused: string, runner: RepointRunner) {
  if (runner.isBusy(card.id)) throw new Error(refused);
  await runner.endSession(card.id);
  updateCard(card.id, patch);
}
