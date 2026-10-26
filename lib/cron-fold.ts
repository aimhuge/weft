import type { Card } from "./types";

// The one rule for which card a card folds under: a cron run folds under its holder (Card.cronOf),
// anything else under the thread that started it (Card.parentId). A fresh cron's first run points at
// itself — it is its own holder — so it folds under the thread that started it instead. The board
// (lib/cron-stacks.ts) and the list view (lib/list-tree.ts, lib/list-crons.ts) both read this, so the
// column view and the sheet never disagree about who owns a run.

// The card a card folds under: its cron's holder, or the thread that started it.
export function foldParentOf(card: Card): string | undefined {
  if (card.cronOf && card.cronOf !== card.id) return card.cronOf;
  return card.parentId;
}

// Whether a run points at itself, which is how a fresh cron's first run holds its own cron's runs.
export function isSelfHolder(card: Card): boolean {
  return card.cronOf === card.id;
}
