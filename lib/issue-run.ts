import { firstMessage } from "./automations";
import { validationMessage } from "./issue-landing";
import { startGate } from "./start-gate";
import type { Card } from "./types";

// Starting the thread of a card the GitHub importer made (lib/github-issues.ts), when the project
// asked for its issues to be worked rather than parked.
//
// It lives here so lib/github-issues.ts doesn't pull the runner in: that module is imported by
// lib/project-seed-find.ts and lib/github-collaborators.ts, which only need a type and an error
// message from it.

type Runner = typeof import("./runner");

// Starts a card's first turn: its prompt, plus the skills a "thread starts" rule names.
//
// When the project named a validation skill (lib/issue-landing.ts), that skill goes first: the card
// is checked before any work happens, and the turn ends in Needs you or Review, not in a change.
//
// A card whose CLI's model is at its limit doesn't get the turn now — it would come straight back
// as a rate-limit error and the card would sit in Needs you, dead. Its first message waits for the
// window to reset (lib/start-gate.ts) and the scheduler sends it the moment it opens.
export async function startIssueCard(card: Card, skill?: string): Promise<void> {
  const gate = startGate(card.backend, card.model);
  const message = [firstMessage(card), validationMessage(skill)].filter(Boolean).join("\n\n");
  if (gate) {
    const { scheduleMessage } = await import("./scheduler");
    scheduleMessage(card.id, message, gate.at);
    return;
  }
  const runner: Runner = await import("./runner");
  runner.sendMessage(card.id, message);
}
