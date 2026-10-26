// What a card's status cell offers in the list view, on a click or a right-click: stop it, run it, carry it
// on, or park it. Only what the card can do right now is listed. Done is left out on purpose: moving a card
// there runs /weft:done, which commits and pushes, and that shouldn't be one slip of a status menu away.
// Pure, so the menu (components/RowStatusCell.tsx) only draws the list.
import { canContinue, canRestart } from "./card-resume";
import { isLive } from "./format";
import type { Card, Column } from "./types";

export type StatusAction = "open" | "stop" | "run" | "continue" | "restart" | "move:backlog" | "move:review";

export interface StatusItem {
  id: StatusAction;
  label: string;
  hint?: string;
  danger?: boolean;
}

export function statusActions(card: Card, column: Column): StatusItem[] {
  const live = isLive(card);
  const items: StatusItem[] = [{ id: "open", label: "Open the thread" }];
  if (live) items.push({ id: "stop", label: "Stop", hint: "End the turn now", danger: true });
  if (column === "backlog" && !live) items.push({ id: "run", label: "Run now", hint: "Start its first message" });
  if (canContinue(card)) items.push({ id: "continue", label: "Continue", hint: "Send “continue” to its session" });
  if (canRestart(card)) items.push({ id: "restart", label: "Restart", hint: "Its last message, in a fresh CLI" });
  if (!live) {
    if (column !== "backlog") items.push({ id: "move:backlog", label: "Move to Backlog" });
    if (column !== "review") items.push({ id: "move:review", label: "Move to Review" });
  }
  return items;
}

// The folders a card can move to: every folder a card on the board runs in, the most recently busy first.
export function knownFolders(cards: Card[]): string[] {
  const latest = new Map<string, number>();
  for (const card of cards) {
    if (card.role === "copilot") continue;
    latest.set(card.cwd, Math.max(latest.get(card.cwd) ?? 0, card.lastActivity ?? card.updatedAt));
  }
  return [...latest.entries()].sort((a, b) => b[1] - a[1]).map(([cwd]) => cwd);
}
