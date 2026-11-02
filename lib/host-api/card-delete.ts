// card.delete: a card gone from its host, the same on every host (docs/architecture/project-hosts.md). The DELETE route
// of app/api/cards/[id] mounts it on this Mac; a worker's daemon runs it from a `host` command. The store's
// card_deleted event is what tells the world: a Mac's outbox and a worker's publisher both mark the card's row deleted,
// so the boards' changed-cards reads list it as `removed`. Deleting your own card widens nothing, so it isn't elevated.
import { endSession } from "../runner";
import { dismissSession } from "../settings";
import { deleteCard, getCard } from "../store";
import { dropWorktree } from "../worktree-pool";
import { OK, type Ok } from "./types";

export const COPILOT_UNDELETABLE = "The copilot can't be deleted. Start a new chat instead.";

export async function deleteCardVerb({ id }: { id: string }): Promise<Ok> {
  const card = getCard(id);
  if (card?.role === "copilot") throw new Error(COPILOT_UNDELETABLE);
  await endSession(id);
  // A picked-up session stays deleted; the sync won't bring it back.
  if (card?.source === "claude-code" && card.sessionId) dismissSession(card.sessionId);
  deleteCard(id);
  // An isolated card's worktree goes with it; a branch with commits that never landed stays (lib/worktree-pool.ts).
  if (card?.worktree) void dropWorktree(card.worktree).catch(() => {});
  return OK;
}
