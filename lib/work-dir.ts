import type { Card } from "./types";

// Where a card's code runs (docs/architecture/worktrees.md). card.cwd is always the project folder: the board's
// project chips, skill sets, sync folders, the changelog and webhooks read it. An isolated card's CLI, Bash, `!` shell,
// dev server and claims run in its worktree instead, at the same place inside the repo the card was made for.
// No node imports: the board's overlap warning (lib/overlap.ts) reads it in the browser too.
export function workDir(card: Pick<Card, "cwd" | "worktree">): string {
  const wt = card.worktree;
  if (!wt) return card.cwd;
  return wt.sub ? `${wt.path}/${wt.sub}` : wt.path;
}

// An isolated card that has asked for a worktree but hasn't got one yet must not start a CLI in the shared tree.
export function awaitingWorktree(card: Pick<Card, "isolated" | "worktree">): boolean {
  return Boolean(card.isolated && !card.worktree);
}
