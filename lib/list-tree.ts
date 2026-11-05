// The list view's rows as a tree: a card a thread started (parentId) or a cron's run (cronOf) folds under
// the card it came from, and a card opened up shows its subagents and those nested cards beneath it.
// The bands run Backlog (folded to start with) then the order you act on them, Needs you first, and a folded
// band keeps its count but draws no rows. Pure, so components/BoardList.tsx only draws what this lays out.
import type { ListGroup } from "./board-view";
import { foldParentOf } from "./cron-fold";
import { rowMatches, sortBy, type Band, type SheetState } from "./list-sheet";
import type { CardTask } from "./tasks";
import type { Card, Column } from "./types";

export const LIST_ORDER: Column[] = ["backlog", "needs_you", "running", "review", "done"];

export type SheetRow =
  | { kind: "card"; card: Card; column: Column; depth: number; kids: number; expanded: boolean; number: number }
  | { kind: "agent"; task: CardTask; parent: Card; depth: number };

export interface SheetGroup {
  column: Column;
  label: string;
  rows: SheetRow[];
  // The band's own cards (not the ones drawn under a parent elsewhere) that pass the filters, and all of them.
  shown: number;
  total: number;
  collapsed: boolean;
}

// The card a card folds under: a cron run's holder, or the thread that started it.
export function parentOf(card: Card): string | undefined {
  return foldParentOf(card);
}

// A card's subagents, the ones it started with the Agent tool, oldest first.
export function agentsOf(card: Card): CardTask[] {
  return (card.tasks ?? []).filter((t) => t.kind === "agent");
}

// A card where the sheet found it: the card, and the band the board put it in.
interface Placed {
  card: Card;
  column: Column;
}

// The top of a card's tree when it folds under another card on the sheet, or null: its parent isn't on the
// sheet, or following parents up comes back round to it (a loop would hide every card in it).
function rootsBy(byId: Map<string, Placed>) {
  return (placed: Placed): Placed | null => {
    let parent = byId.get(parentOf(placed.card) ?? "");
    if (!parent) return null;
    const seen = new Set([placed.card.id]);
    let root = parent;
    for (; parent; parent = byId.get(parentOf(parent.card) ?? "")) {
      if (seen.has(parent.card.id)) return null;
      seen.add(parent.card.id);
      root = parent;
    }
    return root;
  };
}

export function sheetGroups(groups: ListGroup[], state: SheetState, expanded: ReadonlySet<string>, now: number) {
  const all: Placed[] = groups.flatMap((g) => g.cards.map((card) => ({ card, column: g.column })));
  const byId = new Map(all.map((p) => [p.card.id, p]));
  const rootOf = rootsBy(byId);
  // A card also stands on its own in its band when that is where it waits on you, or when its tree's top
  // card sits in a folded band, so a running child never hides behind the folded Backlog.
  const onItsOwn = (placed: Placed) => {
    const root = rootOf(placed);
    return !root || placed.column === "needs_you" || state.collapsed.includes(root.column);
  };

  const kids = new Map<string, Placed[]>();
  for (const placed of all) {
    if (!rootOf(placed)) continue;
    const parent = parentOf(placed.card) as string;
    kids.set(parent, [...(kids.get(parent) ?? []), placed]);
  }
  for (const list of kids.values()) list.sort((a, b) => b.card.createdAt - a.card.createdAt);

  // A card shows when it or any card under it passes the filters, so a match deep in a tree keeps its path.
  const memo = new Map<string, boolean>();
  const keep = (placed: Placed): boolean => {
    let hit = memo.get(placed.card.id);
    if (hit === undefined) {
      hit = rowMatches(placed.card, state.hidden, state.query, now) || (kids.get(placed.card.id) ?? []).some(keep);
      memo.set(placed.card.id, hit);
    }
    return hit;
  };

  let number = 0;
  const rowsOf = (list: Placed[], depth: number): SheetRow[] =>
    sortBy(list.filter(keep), (p) => p.card, state.sort, now).flatMap(({ card, column }) => {
      const under = (kids.get(card.id) ?? []).filter(keep);
      const agents = agentsOf(card);
      const open = expanded.has(card.id);
      number += 1;
      const row: SheetRow = { kind: "card", card, column, depth, kids: under.length + agents.length, expanded: open, number };
      if (!open) return [row];
      return [row, ...agents.map((task): SheetRow => ({ kind: "agent", task, parent: card, depth: depth + 1 })), ...rowsOf(under, depth + 1)];
    });

  let shown = 0;
  let total = 0;
  const out: SheetGroup[] = [];
  for (const column of LIST_ORDER) {
    const group = groups.find((g) => g.column === column);
    if (!group) continue;
    // The band's own cards: the ones that aren't drawn under a parent instead.
    const top = all.filter((p) => p.column === column && onItsOwn(p));
    const matched = top.filter(keep);
    total += top.length;
    shown += matched.length;
    if (!matched.length) continue;
    const collapsed = state.collapsed.includes(column);
    out.push({ column, label: group.label, rows: collapsed ? [] : rowsOf(top, 0), shown: matched.length, total: top.length, collapsed });
  }
  return { groups: out, shown, total };
}

// The bands you can type a new card into (components/SheetQuickAdd.tsx), with their names.
export const ADDABLE: Partial<Record<Column, string>> = { backlog: "Backlog", running: "Running" };

// The bands the sheet draws: every band with cards, plus the Backlog and Running even when they're empty,
// so there is always somewhere to type a new card. With archived cards to reveal (keepDone), Done stays too,
// since its band carries the Show archived toggle.
export function bandsToDraw(groups: SheetGroup[], collapsed: Band[], keepDone = false): SheetGroup[] {
  return LIST_ORDER.flatMap((column) => {
    const group = groups.find((g) => g.column === column);
    if (group) return [group];
    const label = ADDABLE[column] ?? (keepDone && column === "done" ? "Done" : undefined);
    return label ? [{ column, label, rows: [], shown: 0, total: 0, collapsed: collapsed.includes(column) }] : [];
  });
}
