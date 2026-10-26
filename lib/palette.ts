// What the command palette lists for a query: word scoring, and the grouped, ranked results.
import type { IconName } from "@/components/Icon";
import type { Column } from "./types";

export type PaletteItem = {
  id: string;
  group: "Recently changed" | "Commands" | "Projects" | "Cards" | "Prompts";
  // The card a card or prompt item opens, so one card isn't listed twice.
  cardId?: string;
  label: string;
  // Dimmer text after the label, e.g. a project's path.
  detail?: string;
  // The project folder a card belongs to, drawn as a colored chip; on a project item it tints the icon.
  project?: string;
  // A card's column, drawn as a colored status pill.
  column?: Column;
  // The project folder a card or prompt sits in, for the "only this project" scope.
  root?: string;
  // Extra words that match the search without being shown.
  keywords?: string;
  icon: IconName;
  // A line of the prompt that matched, with the matched words between \u0001 and \u0002.
  snippet?: string;
  // A card's last line of output (or its error), on a second line.
  preview?: string;
  // How long ago the card last changed, at the row's right edge.
  when?: string;
  // A key spec from the shortcut registry, drawn as key caps.
  keys?: string;
  run: () => void;
};

const GROUPS: PaletteItem["group"][] = ["Commands", "Projects", "Cards", "Prompts"];
export const CARD_LIMIT = 30;
export const RECENT_CARDS = 6;
// Recent moves shown before "Show more"; the board hands the palette up to RECENT_MOVE_LIMIT of them.
export const RECENT_MOVES = 5;
export const RECENT_MOVE_LIMIT = 30;
// The row that opens the rest of the recent moves in place, instead of running and closing.
export const RECENT_MORE_ID = "recent-more";

// Every word typed must appear somewhere; earlier and label matches rank higher. null means no match.
export function score(item: PaletteItem, words: string[]): number | null {
  const label = item.label.toLowerCase();
  const rest = `${item.detail ?? ""} ${item.keywords ?? ""}`.toLowerCase();
  let total = 0;
  for (const word of words) {
    const at = label.indexOf(word);
    if (at >= 0) total += at === 0 || label[at - 1] === " " ? 0 : 1;
    else if (rest.includes(word)) total += 3;
    else return null;
  }
  return total;
}

function showMoreItem(hidden: number): PaletteItem {
  return { id: RECENT_MORE_ID, group: "Recently changed", label: `Show ${hidden} more`, detail: "newest first", icon: "clock", run: () => {} };
}

// The palette's rows for the typed query: with nothing typed, recent moves, commands, projects and the
// latest cards; otherwise each group's hits ranked by score, plus the prompts matching this very query.
export function paletteResults(
  items: PaletteItem[],
  query: string,
  prompts: { query: string; items: PaletteItem[] },
  scope: string | null,
  allRecent = false,
): PaletteItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const inScope = (i: PaletteItem) => !scope || i.root === undefined || i.root === scope;
  const byGroup = (group: PaletteItem["group"]) => items.filter((i) => i.group === group && inScope(i));
  if (words.length === 0) {
    // Nothing typed: the cards that just changed column (the first few, then a row that shows the rest),
    // every command and project, and the latest other cards (items arrive newest first).
    const allMoved = byGroup("Recently changed");
    const moved = allRecent ? allMoved : allMoved.slice(0, RECENT_MOVES);
    const hidden = allMoved.length - moved.length;
    const more: PaletteItem[] = hidden > 0 ? [showMoreItem(hidden)] : [];
    const shown = new Set(moved.map((i) => i.cardId));
    const latest = byGroup("Cards").filter((i) => !shown.has(i.cardId));
    return [...moved, ...more, ...byGroup("Commands"), ...byGroup("Projects"), ...latest.slice(0, RECENT_CARDS)];
  }
  const promptItems = prompts.query === query.trim() ? prompts.items.filter(inScope) : [];
  return GROUPS.flatMap((group) => {
    if (group === "Prompts") return promptItems;
    const hits = byGroup(group)
      .map((item, order) => ({ item, order, rank: score(item, words) }))
      .filter((h): h is { item: PaletteItem; order: number; rank: number } => h.rank !== null)
      .sort((a, b) => a.rank - b.rank || a.order - b.order);
    return (group === "Cards" ? hits.slice(0, CARD_LIMIT) : hits).map((h) => h.item);
  });
}
