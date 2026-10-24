// The upload half of a flush (lib/cloud-sync.ts): turns the compacted outbox into rows and ships them.
// Cards, deletes and truncates go first, then thread items in chunks, each acknowledged (dropped from the
// outbox) as it lands, so a big backlog makes progress and one bad batch can't hold the rest back.
import type { SupabaseClient } from "@supabase/supabase-js";
import { replaceOutboxHead } from "./cloud-outbox";
import { cardRows } from "./cloud-sync-cards";
import { check, isRowError, upsert } from "./cloud-sync-send";
import { redactCardRow, redactItemRow, redactOutputRow } from "./cloud-sync-redact";
import { TOOL_RESULT_INLINE_MAX, type BlobStore, type CloudThreadItemRow, type CloudToolOutputRow, type OutboxEntry } from "./cloud-sync-types";
import { getCard, getThread } from "./store";
import type { ThreadItem } from "./types";

// Items per request. A first sync of a long-used folder is tens of thousands of entries.
export const ITEM_CHUNK = 100;

type ItemEntry = Extract<OutboxEntry, { op: "item" }>;

export interface UploadCtx {
  blobs: BlobStore;
  now: () => number;
}

// What a flush leaves behind when the server refused some rows for good (bad data, not a bad connection).
export interface Skipped {
  count: number;
  message: string;
}

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
function splitToolResult(item: ThreadItem): { item: ThreadItem; output?: Omit<CloudToolOutputRow, "org_id" | "card_id"> } {
  if (item.kind !== "tool" || !item.result || item.result.length <= TOOL_RESULT_INLINE_MAX) return { item };
  const { result, ...rest } = item;
  return { item: { ...rest, resultBytes: result.length }, output: { tool_id: item.id, result, bytes: result.length } };
}

// Ships `pending` (compacted, oldest first). `onShipped` hears each batch's item count as it lands, so the
// Sync page counts up during a long upload. A failure throws with whatever shipped already acknowledged.
export async function uploadPending(
  ctx: UploadCtx,
  client: SupabaseClient,
  orgId: string,
  pending: OutboxEntry[],
  onShipped: (items: number) => void,
): Promise<Skipped | null> {
  const cards = scrub((await cardRows(ctx.blobs, orgId, pending, ctx.now())).map(redactCardRow));
  for (let i = 0; i < cards.length; i += ITEM_CHUNK) await putCards(client, cards.slice(i, i + ITEM_CHUNK));
  for (const entry of pending) {
    // The row keeps the card json it last uploaded; a card that never synced matches no row.
    if (entry.op === "card_deleted") {
      const at = new Date(ctx.now()).toISOString();
      check(await client.from("cloud_cards").update({ deleted: true, updated_at: at }).eq("org_id", orgId).eq("card_id", entry.cardId));
    }
    if (entry.op === "truncate") {
      check(await client.from("cloud_thread_items").delete().eq("org_id", orgId).eq("card_id", entry.cardId).gte("seq", entry.seq));
    }
  }
  // Cards, deletes and truncates are done: leave only the items in the outbox, so each chunk can drop off its head.
  const items = pending.filter((e): e is ItemEntry => e.op === "item");
  replaceOutboxHead(pending.length, items);
  return shipItems(ctx, client, orgId, items, onShipped);
}

// A chunk of cards. When the WAF still blocks it escaped, each card goes alone so only the one it matches
// is held back; items need their card's row, so that one card still fails the flush, now with a readable error.
async function putCards(client: SupabaseClient, rows: object[]) {
  try {
    await upsert(client, "cloud_cards", rows);
  } catch (err) {
    if (!isRowError(err) || rows.length === 1) throw err;
    for (const row of rows) await upsert(client, "cloud_cards", [row]);
  }
}

async function shipItems(ctx: UploadCtx, client: SupabaseClient, orgId: string, items: ItemEntry[], onShipped: (n: number) => void): Promise<Skipped | null> {
  let count = 0;
  let message = "";
  for (let i = 0; i < items.length; i += ITEM_CHUNK) {
    const chunk = items.slice(i, i + ITEM_CHUNK);
    try {
      onShipped(await putItems(ctx, client, orgId, chunk));
    } catch (err) {
      if (!isRowError(err)) throw err;
      // The server refused something in this chunk: find it by sending the rest one at a time, and skip it.
      for (const entry of chunk) {
        try {
          onShipped(await putItems(ctx, client, orgId, [entry]));
        } catch (one) {
          if (!isRowError(one)) throw one;
          count++;
          message = `${one.message} (card ${entry.cardId}, item ${entry.seq})`;
        }
      }
    }
    replaceOutboxHead(chunk.length, []);
  }
  return count ? { count, message } : null;
}

// Tool outputs first, then the items that point at them, each in one upsert. Returns the items shipped.
async function putItems(ctx: UploadCtx, client: SupabaseClient, orgId: string, entries: OutboxEntry[]): Promise<number> {
  const items: CloudThreadItemRow[] = [];
  const outputs: CloudToolOutputRow[] = [];
  for (const entry of entries) {
    if (entry.op !== "item" || !getCard(entry.cardId)) continue;
    const live = getThread(entry.cardId)[entry.seq];
    if (!live) continue;
    const { item, output } = splitToolResult(await ctx.blobs.rewriteItem(live, orgId));
    items.push({ org_id: orgId, card_id: entry.cardId, seq: entry.seq, kind: item.kind, item, at: new Date(live.at).toISOString() });
    if (output) outputs.push({ org_id: orgId, card_id: entry.cardId, ...output });
  }
  if (outputs.length) await upsert(client, "cloud_tool_outputs", scrub(lastPerKey(outputs, (o) => `${o.card_id}/${o.tool_id}`).map(redactOutputRow)));
  if (items.length) await upsert(client, "cloud_thread_items", scrub(lastPerKey(items, (i) => `${i.card_id}/${i.seq}`).map(redactItemRow)));
  return items.length;
}

// One row per primary key in a request: Postgres refuses an upsert that names a row twice ("ON CONFLICT DO UPDATE
// command cannot affect row a second time"). Codex reuses tool ids like "item_1" from turn to turn, so a chunk can
// hold two outputs for one key; the later one wins, as it would across requests.
function lastPerKey<T>(rows: T[], key: (row: T) => string): T[] {
  return [...new Map(rows.map((row) => [key(row), row])).values()];
}
