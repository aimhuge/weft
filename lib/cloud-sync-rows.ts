// The pure steps that make a synced row out of a card or a thread item, shared by a Mac's outbox
// (lib/cloud-sync-upload.ts) and a Weft Worker's publisher (lib/worker-publish.ts). No store, no client: just values.
import { TOOL_RESULT_INLINE_MAX, type CloudToolOutputRow } from "./cloud-sync-types";
import type { ThreadItem } from "./types";

// Postgres refuses "\u0000" in text and jsonb and a lone UTF-16 surrogate in either ("unsupported Unicode
// escape sequence"), and a terminal's output or a clipped string has both. Strip the first, replace the second.
const NUL = /\u0000/g;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

export function scrub<T>(value: T): T {
  if (typeof value === "string") return (value.includes("\u0000") || /[\ud800-\udfff]/.test(value) ? value.replace(NUL, "").replace(LONE_SURROGATE, "�") : value) as T;
  if (Array.isArray(value)) return value.map(scrub) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v)])) as T;
  return value;
}

// Pulls a long tool result out of its item, leaving resultBytes in its place. The full string goes to
// cloud_tool_outputs, keyed by the tool id.
export function splitToolResult(item: ThreadItem): { item: ThreadItem; output?: Omit<CloudToolOutputRow, "org_id" | "card_id"> } {
  if (item.kind !== "tool" || !item.result || item.result.length <= TOOL_RESULT_INLINE_MAX) return { item };
  const { result, ...rest } = item;
  return { item: { ...rest, resultBytes: result.length }, output: { tool_id: item.id, result, bytes: result.length } };
}
