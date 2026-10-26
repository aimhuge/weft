import { foldParentOf } from "./cron-fold";
import type { Card, Column } from "./types";

// A cron's runs fold into a stack on the board (components/CronStack.tsx): under the thread they were forked from,
// or under the cron's first run when it has none (Card.cronOf). Clicking the stack fans them out. A run that waits on
// you stays in Needs you as well, so a question never hides in a stack. Pure, so it's testable.

export interface Stacks {
  byColumn: Map<Column, Card[]>;
  // Each holder's runs, newest first.
  stacks: Map<string, Card[]>;
}

export function stackRuns(byColumn: Map<Column, Card[]>): Stacks {
  const shown = new Set<string>();
  for (const list of byColumn.values()) for (const card of list) shown.add(card.id);
  const stacks = new Map<string, Card[]>();
  // A run whose holder is on screen goes in its stack; one whose holder isn't stays where it is.
  // Only a cron's run stacks: a card started by another thread stays in its column (lib/list-tree.ts draws that tree).
  const stacked = (card: Card) => {
    const holder = card.cronOf;
    return Boolean(holder && holder !== card.id && shown.has(holder));
  };
  for (const list of byColumn.values()) {
    for (const card of list) {
      if (!stacked(card)) continue;
      // A stacked run's holder is its cronOf, and stacked() has just checked it is a card on screen.
      const holder = foldParentOf(card) as string;
      const runs = stacks.get(holder) ?? [];
      runs.push(card);
      stacks.set(holder, runs);
    }
  }
  for (const runs of stacks.values()) runs.sort((a, b) => (b.cronRun ?? 0) - (a.cronRun ?? 0) || b.createdAt - a.createdAt);
  const folded = new Map<Column, Card[]>();
  for (const [column, list] of byColumn) folded.set(column, list.filter((card) => !stacked(card) || column === "needs_you"));
  return { byColumn: folded, stacks };
}
