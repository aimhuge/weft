import { globalSingleton } from "./global-singleton";
import { getCard, updateCard } from "./store";
import { takeWorktree } from "./worktree-pool";

// An isolated card's first message waits for its worktree (docs/architecture/worktrees.md): whichever way the turn
// starts (New thread, Backlog → Running, the scheduler), lib/runner.ts sendMessage hands it here, the card takes a
// worktree from the pool (~20 ms; ~15 s with none ready) and the message goes out from there. Shared cards never come here.

const takes = globalSingleton("__weftWorktreeTakes", () => new Map<string, Promise<boolean>>());

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function take(cardId: string): Promise<boolean> {
  const card = getCard(cardId);
  if (!card) return false;
  if (card.worktree) return true;
  updateCard(cardId, { column: "running", lastLine: "Making its worktree…" });
  try {
    updateCard(cardId, { worktree: await takeWorktree(card) });
    return true;
  } catch (err) {
    // Never fall back to the shared tree on its own: the card says why, stops being isolated, and the message waits for you.
    updateCard(cardId, {
      column: "needs_you",
      isolated: false,
      lastLine: "No worktree",
      error: `Couldn't give this card a worktree of its own: ${errorText(err)} It now works in the shared folder; send your message again to run it there.`,
    });
    return false;
  }
}

// Takes the card's worktree (once, however many messages wait on it), then runs `then`: the held send.
export function isolate(cardId: string, then: () => void): Promise<void> {
  let pending = takes.get(cardId);
  if (!pending) {
    pending = take(cardId).finally(() => takes.delete(cardId));
    takes.set(cardId, pending);
  }
  return pending.then((ok) => {
    if (!ok) return;
    try {
      then();
    } catch (err) {
      updateCard(cardId, { error: errorText(err) });
    }
  });
}
