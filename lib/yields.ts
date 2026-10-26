import { claimFiles } from "./claims";
import { isBusy } from "./overlap";
import { listCards, updateCard } from "./store";
import type { Card, CardYield } from "./types";

// The yields Me first leaves on a card (lib/precedence.ts), and when they end. Apart from lib/precedence.ts,
// which reaches into the runner, so the claim guards can prune without importing it.

// A yield lasts while the card it yields to is busy and still claims the file: once it commits (its claims on
// the file drop) or its turn ends, the file is shared again.
export function yieldHolds(cards: Card[], y: CardYield) {
  const to = cards.find((c) => c.id === y.to);
  return Boolean(to && !to.archived && isBusy(to) && claimFiles(to).has(y.file));
}

// Drops the yields that no longer hold, before a guard looks for clashes (lib/claim-guard.ts, lib/bash-claims.ts),
// so a card that committed and edits the file again doesn't still skip the other card's claims.
export function pruneYields(cards: Card[] = listCards()) {
  for (const card of cards) {
    if (!card.yields?.length) continue;
    const kept = card.yields.filter((y) => yieldHolds(cards, y));
    if (kept.length !== card.yields.length) updateCard(card.id, { yields: kept.length ? kept : undefined });
  }
}
