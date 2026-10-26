import type { Card } from "./types";
import { isFiltering, type RailFilter } from "./rail-view";
import type { latestLimits } from "./board-view";
import { looksScratch } from "./scratch";

// Small values the board reads off its state each render, kept out of Board.tsx so its body is state
// and wiring, not branches.

type Latest = ReturnType<typeof latestLimits>;

// Whether anything narrows the board, and a key for what does: picking another project or changing
// the filter collapses expanded columns again.
export function filterState(project: string | null, query: string, rail: RailFilter) {
  const q = query.trim();
  return {
    filtering: Boolean(project || q || isFiltering(rail)),
    view: `${project ?? ""}\n${q}\n${rail.starred ? "★" : ""}${rail.tag ?? ""}`,
  };
}

// The footer's stats, folder and CLI: the open card's. With no card open it shows only every CLI's plan
// limits (components/StatusStrip.tsx), never another card's numbers passed off as the board's.
export function footerFor(selected: Card | null) {
  return selected
    ? { stats: selected.stats, cwd: selected.cwd, backend: selected.backend }
    : { stats: undefined, cwd: undefined, backend: undefined };
}

// The folder the board is about right now: the open card's, the selected project, else the latest card's.
export function workFolder(selected: Card | null, project: string | null, latest: Latest) {
  return selected?.cwd ?? project ?? latest?.cwd;
}

// The project the avatar menu offers to sync or stop syncing (components/AccountSync.tsx): the board's work folder as
// its main checkout, and never a scratch folder.
export function menuProject(folder: string | null | undefined, rootOf: (cwd: string) => string): string | null {
  if (!folder) return null;
  const root = rootOf(folder);
  return looksScratch(root) ? null : root;
}

// The copilot opens in the same window as any card, though it lives apart from cards.
export function openCardOf(cards: Card[], copilot: Card | null, id: string | null): Card | null {
  return cards.find((c) => c.id === id) ?? (copilot?.id === id ? copilot : null);
}

// The header's Running and Needs you counts; archived cards are hidden from the board, so not counted.
export function headerCounts(cards: Card[]) {
  const live = cards.filter((c) => !c.archived);
  return {
    running: live.filter((c) => c.column === "running").length,
    waiting: live.filter((c) => c.column === "needs_you").length,
  };
}
