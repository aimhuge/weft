import type { Card } from "./types";
import { isFiltering, type RailFilter } from "./rail-view";
import type { latestLimits } from "./board-view";
import { looksScratch } from "./scratch";
import type { WorkerProject } from "./worker-project";

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

// The worker the terminal would have to reach, by name: the open worker card's, else (no card open) the chosen worker
// project's. Without a signer the terminal is this Mac's shell, so on either it says it isn't there rather than open one
// somewhere else; `signed` (the drawer's folder is that worker project, lib/board-folders.ts) opens the worker's own over
// its line with a Touch ID approval (lib/line-terminal.ts), so there's nothing to say.
export function terminalAway(openWorker: { name: string } | null | undefined, project: string | null, projects: readonly WorkerProject[], cardOpen: boolean, signed = false): string | null {
  if (signed) return null;
  if (openWorker) return openWorker.name;
  if (cardOpen || !project) return null;
  return projects.find((p) => p.path === project)?.worker ?? null;
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

// The header's Running and Needs you counts live with the grouping, in @weft/client.
export { headerCounts } from "@weft/client";

// The card in the frame: this Mac's open card, or a worker's (lib/use-worker-board.ts openWorkerThread).
export const framedCard = (selected: Card | null, worker: { card: Card } | null) => selected ?? worker?.card ?? null;

// The open card's ☆, tags, Share… and archive, for the card in the frame (this Mac's or a worker's): each a no-op with
// none open. The functions are the board's own, which act through the card's host (lib/project-host.ts).
export function openCardMarks(card: Card | null, act: { star: (c: Card) => void; tags: (c: Card) => void; share: (c: Card) => void; archive: (c: Card) => void }) {
  const on = (fn: (c: Card) => void) => () => {
    if (card) fn(card);
  };
  return { onStar: on(act.star), onTags: on(act.tags), onShare: on(act.share), onArchive: on(act.archive) };
}
