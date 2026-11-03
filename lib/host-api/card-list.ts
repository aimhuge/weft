// card.list: the board's cards on this host, without the copilot (it has its own window), and each worktree folder's
// main repo, so the project bar folds a worktree into it. GET /api/cards runs it for this Mac's board. On a worker it
// is a host-level verb (no card), and the worker answers with what it publishes instead (lib/worker-reads.ts), so a
// line's snapshot matches the cards its `events` carry.
import { projectRoot } from "../repos";
import { listProjects } from "../settings";
import { listCards } from "../store";
import type { Card } from "../types";
import { settle } from "./types";

export type CardList = { cards: Card[]; roots: Record<string, string> };

export function listCardsVerb(): Promise<CardList> {
  return settle(() => {
    const cards = listCards().filter((c) => c.role !== "copilot");
    const roots: Record<string, string> = {};
    for (const folder of new Set([...cards.map((c) => c.cwd), ...listProjects().map((p) => p.path)])) {
      const root = projectRoot(folder);
      if (root !== folder) roots[folder] = root;
    }
    return { cards, roots };
  });
}
