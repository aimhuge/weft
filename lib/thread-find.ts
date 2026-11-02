// Find in a thread, over its data rather than its DOM: a thread draws only its newest page, and tool runs,
// edited turns and long results stay folded, so what's on screen is a fraction of what can match. The server
// runs this over the whole stored thread (app/api/cards/[id]/thread/search), and lib/use-thread-find.ts
// reveals the match it lands on. A transport with no search runs it over the loaded window instead.
import type { ThreadItem } from "./types";

// An item with `hits` occurrences of the query; index is absolute in the thread, like ThreadPage.start.
export type FindMatch = { index: number; hits: number };
// One occurrence: the nth within item `index`.
export type FindSpot = { index: number; nth: number };

// Markdown as it reads on screen, so "foo bar" finds "foo **bar**" and a link matches by its text.
export function plainMarkdown(text: string): string {
  return text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*|__|~~|`/g, "");
}

// The text an item shows, folded or not. Short markers ("Turn finished") aren't anything to look for.
export function findableText(item: ThreadItem): string {
  switch (item.kind) {
    case "user":
    case "assistant":
      return plainMarkdown(item.text);
    case "tool":
      return [item.name, item.summary, item.result, ...(item.edit?.lines.map((l) => l.text) ?? [])].filter(Boolean).join("\n");
    case "permission":
      return [item.title, item.answer].filter(Boolean).join("\n");
    case "result":
      return item.isError ? item.text : "";
    case "notification":
      return item.summary;
    case "spliced":
      return plainMarkdown(item.brief);
    case "edited":
      return item.items.map(findableText).join("\n");
    case "shell":
      return [item.command, item.output].filter(Boolean).join("\n");
  }
}

function countHits(text: string, needle: string): number {
  let hits = 0;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) hits++;
  return hits;
}

// Every item holding the query, oldest first, ignoring case. A stored thread can hold a null hole.
export function matchThread(items: readonly (ThreadItem | null | undefined)[], query: string, start = 0): FindMatch[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const matches: FindMatch[] = [];
  items.forEach((item, i) => {
    const hits = item ? countHits(findableText(item).toLowerCase(), needle) : 0;
    if (hits) matches.push({ index: start + i, hits });
  });
  return matches;
}

export const totalHits = (matches: readonly FindMatch[]) => matches.reduce((sum, m) => sum + m.hits, 0);

// The occurrence at `ordinal`, counted from the newest: a thread is read from its bottom, so the first
// match is the nearest one, and Enter walks back up. Stepping past either end wraps.
export function spotAt(matches: readonly FindMatch[], ordinal: number): FindSpot | undefined {
  const total = totalHits(matches);
  if (!total) return undefined;
  let left = ((ordinal % total) + total) % total;
  for (const { index, hits } of [...matches].reverse()) {
    if (left < hits) return { index, nth: hits - 1 - left };
    left -= hits;
  }
  return undefined;
}

// What the find field reads: nothing before a query, an ellipsis until the search answers, then "2 of 14".
export function findCount(query: string, matches: readonly FindMatch[] | null, ordinal: number): string {
  if (!query) return "";
  if (!matches) return "…";
  const total = totalHits(matches);
  return total ? `${((ordinal % total) + total) % total + 1} of ${total}` : "0 of 0";
}
