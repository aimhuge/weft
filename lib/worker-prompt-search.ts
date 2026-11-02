// The ⌘K palette's prompt search over a worker's cards. This Mac's own come from its search index (GET /api/search),
// which reads the local store's threads; a worker's threads aren't there, so their cards' first prompts are matched here
// against what the board already holds, case-insensitively, with a snippet round the match.
import type { Card } from "./types";
import { isWorkerCard } from "./worker-project";

const AROUND = 60;

export function workerPromptHits(cards: readonly Card[], query: string): { cardId: string; snippet: string }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return cards.flatMap((card) => {
    const prompt = isWorkerCard(card) ? card.prompt : "";
    const at = prompt.toLowerCase().indexOf(q);
    if (at < 0) return [];
    const from = Math.max(0, at - AROUND);
    const snippet = `${from ? "…" : ""}${prompt.slice(from, at + q.length + AROUND)}${at + q.length + AROUND < prompt.length ? "…" : ""}`;
    return [{ cardId: card.id, snippet }];
  });
}
