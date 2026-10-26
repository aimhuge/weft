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
  const stacked = (card: Card) => Boolean(card.cronOf && card.cronOf !== card.id && shown.has(card.cronOf));
  for (const list of byColumn.values()) {
    for (const card of list) {
      if (!stacked(card)) continue;
      const runs = stacks.get(card.cronOf as string) ?? [];
      runs.push(card);
      stacks.set(card.cronOf as string, runs);
    }
  }
  for (const runs of stacks.values()) runs.sort((a, b) => (b.cronRun ?? 0) - (a.cronRun ?? 0) || b.createdAt - a.createdAt);
  const folded = new Map<Column, Card[]>();
  for (const [column, list] of byColumn) folded.set(column, list.filter((card) => !stacked(card) || column === "needs_you"));
  return { byColumn: folded, stacks };
}
