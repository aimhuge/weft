// Paging a thread: how the /api/cards/[id]/thread route sends a slice of items, and how the client
// turns the same items it already loaded into a window of the whole thread (so the live "thread"
// event, which uses an absolute index, lands on the right row).
//
// The first page is the newest items (the user is reading the bottom); before=<n> walks back to
// the items with index < n, capped at limit. With no params the route sends everything (back-compat
// for callers that don't page yet).
import type { ThreadItem } from "./thread-items";

// A tool result longer than this is left out of the thread item (it gets `resultBytes` instead) and fetched
// when the row is opened: locally from /api/cards/[id]/thread/tool/[toolId], remotely from cloud_tool_outputs.
export const TOOL_RESULT_INLINE_MAX = 2048;

// How many items the thread route sends per page, newest first.
export const THREAD_PAGE_SIZE = 50;

export interface PageOptions {
  // The index the page ends at (exclusive). Unset = the newest page.
  before?: number;
  // The maximum items to return; defaults to THREAD_PAGE_SIZE.
  limit?: number;
}

export interface ThreadPage {
  // The items in the page, in their original order (newest first within the page itself, but the
  // page itself is the newest slice when before is unset).
  items: ThreadItem[];
  // The index of items[0] in the full thread. 0 when the page starts at the oldest item.
  start: number;
  // items.length of the full thread, so the client knows what it has and what it could still load.
  total: number;
}

// A single page from the full thread, with before / limit both optional.
export function pageThread(items: ThreadItem[], options: PageOptions = {}): ThreadPage {
  const total = items.length;
  const limit = clampLimit(options.limit);
  // No before: the newest page — the last `limit` items. start is the index of the first one.
  if (options.before === undefined || options.before > total) {
    const start = Math.max(0, total - limit);
    return { items: items.slice(start), start, total };
  }
  // before is the first index the page can't include; clamp to [0, total].
  const before = Math.max(0, Math.min(options.before, total));
  // The page ends at `before` and goes back `limit` items from there.
  const start = Math.max(0, before - limit);
  return { items: items.slice(start, before), start, total };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return THREAD_PAGE_SIZE;
  return Math.floor(limit);
}

// A tool result longer than TOOL_RESULT_INLINE_MAX is left out of the thread item, with `resultBytes`
// set so the row can say how much it holds. The full result is fetched on demand (the row's
// /api/cards/<id>/thread/tool/<toolId> route). Other items pass through unchanged.
export function trimToolResult(item: ThreadItem): ThreadItem {
  if (item.kind !== "tool" || item.result === undefined) return item;
  if (item.result.length <= TOOL_RESULT_INLINE_MAX) return item;
  // Drop result, keep the rest, set resultBytes to the original length.
  return { ...item, result: undefined, resultBytes: item.result.length };
}

// The full result of a tool call by its id, wherever the item is: at the top level, or nested in
// an "edited" fold. Returns undefined when no tool with that id has a result to fetch.
export function findToolResult(items: ThreadItem[], toolId: string): string | undefined {
  for (const item of items) {
    const found = matchToolResult(item, toolId);
    if (found !== undefined) return found;
    if (item.kind === "edited") {
      for (const inner of item.items) {
        const innerFound = matchToolResult(inner, toolId);
        if (innerFound !== undefined) return innerFound;
      }
    }
  }
  return undefined;
}

function matchToolResult(item: ThreadItem, toolId: string): string | undefined {
  if (item.kind !== "tool") return undefined;
  if (item.id !== toolId) return undefined;
  return item.result;
}

// A live "thread" event (the app's lib/types.ts) lands in the loaded window. The event's index is absolute
// in the full thread, so the local index is event.index - page.start. If the event points outside
// the window, drop it: the server re-fetch on reconnect will catch up.
export function applyThreadEvent(
  prev: ThreadPage,
  event: { index: number; item: ThreadItem; truncate?: boolean },
): ThreadPage {
  const local = event.index - prev.start;
  // A truncate (an edit with ↑ folding its turn, lib/store.ts foldThread) puts the item at index and drops
  // everything after it. When the fold starts above the window, the whole window was folded into it.
  if (event.truncate) {
    if (local < 0) return { items: [event.item], start: event.index, total: event.index + 1 };
    return { items: [...prev.items.slice(0, local), event.item], start: prev.start, total: event.index + 1 };
  }
  const total = Math.max(prev.total, event.index + 1);
  if (local < 0 || local > prev.items.length) return { ...prev, total };
  const next = prev.items.slice();
  next[local] = event.item;
  return { items: next, start: prev.start, total };
}

// Merge a newly-loaded older page into the current window: prepend items we don't already have
// and adopt the older page's start. Used by the board when the user scrolls near the top.
export function mergeOlderPage(prev: ThreadPage, older: ThreadPage): ThreadPage {
  const seen = new Set(prev.items.map((_, i) => i + prev.start));
  const newOlder = older.items.filter((_, i) => !seen.has(i + older.start));
  return { items: newOlder.concat(prev.items), start: older.start, total: Math.max(prev.total, older.total) };
}
