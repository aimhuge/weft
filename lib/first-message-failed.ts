import { isLive } from "./format";
import { MODELS } from "./new-thread";
import type { Card, ThreadItem } from "./types";

// Why only the open thread shows the rerun banner (lib/components/FirstMessageErrorBanner.tsx):
// the "first message failed" case is the only one where rerunning on a different model
// actually helps. A later turn failing in the same card already has progress — Continue /
// Restart cover it (lib/card-resume.ts). This predicate is the single source of truth:
// the banner renders, the ThreadView test asserts against it.
export function firstMessageFailed(card: Card, items: readonly (ThreadItem | null | undefined)[]): boolean {
  if (!card.error || isLive(card)) return false;
  // Exactly one user message in the thread (the original prompt).
  const users = items.filter((i): i is Extract<ThreadItem, { kind: "user" }> => i?.kind === "user");
  if (users.length !== 1) return false;
  // No assistant text after it: the turn produced nothing useful (an error result, a tool
  // call that didn't finish, or nothing at all).
  return !items.some((i) => i?.kind === "assistant" && i.text.trim());
}

// What a worker's card reruns on where there are no Settings to read the synced backup model from (weft.zip): its own CLI's default, the first model that CLI serves, or the next one when the card
// already ran on the default, since a rerun on the model that failed would likely hit the same wall.
export function hostRerunModel(card: Pick<Card, "backend" | "model">): string {
  // Only a CLI with one model (Codex's, Goose's own pick) finds none other, and then the card is on that one.
  return MODELS[card.backend].find((m) => m.id !== card.model)?.id ?? String(card.model);
}
