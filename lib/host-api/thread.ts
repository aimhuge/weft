// A card's thread, read: a page of it (thread.page), which items hold a phrase (thread.search), and one tool call's
// whole result where its item was trimmed (thread.tool). The routes under app/api/cards/[id]/thread run them for this
// Mac's board. A worker runs them for a card it runs, reached over its session line or a `host` row, and answers in the
// projection it publishes (lib/worker-reads.ts): redacted as the rows are, never more than its cloud rows hold.
import { loadTranscript } from "../import";
import { getThread } from "../store";
import { matchThread, type FindMatch } from "../thread-find";
import { findToolResult, pageThread, trimToolResult, type ThreadPage } from "../thread-page";
import { NotFound, requireCard, settle } from "./types";

export type PageArgs = { id: string; before?: unknown; limit?: unknown };

// A whole number, or unset: a query param or an arg off the network that isn't one reads as unset.
const whole = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : undefined);

// With before or limit the thread comes a page at a time, newest first (lib/thread-page.ts); with neither, whole, so
// older clients keep working. A tool result longer than the inline cap is left out of its item, trimmed after the
// slice so `total` still counts the whole thread.
export async function threadPageVerb({ id, before, limit }: PageArgs): Promise<ThreadPage> {
  const card = requireCard(id);
  try {
    await loadTranscript(card);
  } catch (err) {
    console.error("Couldn't read the session transcript:", err);
  }
  const items = getThread(id);
  const options = { before: whole(before), limit: whole(limit) };
  const paged = options.before !== undefined || options.limit !== undefined;
  const page = paged ? pageThread(items, options) : { items, start: 0, total: items.length };
  return { items: page.items.map(trimToolResult), start: page.start, total: page.total };
}

// Find in a thread: over the whole stored thread and every long tool result a page leaves out (lib/thread-find.ts).
export function threadSearchVerb({ id, q }: { id: string; q?: unknown }): Promise<{ matches: FindMatch[] }> {
  return settle(() => {
    requireCard(id);
    return { matches: matchThread(getThread(id), typeof q === "string" ? q : "") };
  });
}

// The full result of a tool call whose inline result was trimmed (TOOL_RESULT_INLINE_MAX), as its row opens.
export function threadToolVerb({ id, toolId }: { id: string; toolId: unknown }): Promise<{ result: string }> {
  return settle(() => {
    requireCard(id);
    const result = findToolResult(getThread(id), typeof toolId === "string" ? toolId : "");
    if (result === undefined) throw new NotFound("No such tool result.");
    return { result };
  });
}
