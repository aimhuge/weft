// The header's pile and Backlog counts for a folder, read from the host's own disk and store: what /api/pile and
// /api/sprint answer on this Mac, and what a Weft Worker puts in its project snapshot (lib/project-snapshot.ts), so the
// two can't count differently. Each also hands back the map its walk-through prompt is written from.
import { mapPile, readPile, repoCards, repoRoot } from "./commit-pile";
import type { BacklogSummary, PileSummary } from "./project-reads";
import { mapBacklog } from "./sprint-plan";
import type { Card } from "./types";

// The uncommitted pile in the repo holding cwd, or null when it's clean or not a repo.
export function pileOf(cwd: string, cards: Card[]) {
  const pile = readPile(cwd);
  if (!pile) return null;
  const map = mapPile(pile.files, repoCards(cards, pile.root), pile.root);
  const summary: PileSummary = {
    root: pile.root,
    files: pile.files.length,
    added: pile.added,
    removed: pile.removed,
    cards: map.cards.filter((c) => c.files.length).length,
  };
  return { pile, map, summary };
}

// The Backlog of the repo holding cwd (of the folder when it isn't a repo), or null when nothing waits there.
export function backlogOf(cwd: string, cards: Card[]) {
  let root = cwd;
  try {
    root = repoRoot(cwd);
  } catch {}
  const map = mapBacklog(cards, root);
  if (!map.backlog.length) return null;
  const summary: BacklogSummary = { root, count: map.backlog.length, active: map.active.length };
  return { root, map, summary };
}
