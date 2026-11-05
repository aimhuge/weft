// The upload half of a flush (lib/cloud-sync.ts): turns the compacted outbox into rows and ships them.
// Cards, deletes and truncates go first, then thread items in chunks, each acknowledged (dropped from the
// outbox) as it lands, so a big backlog makes progress and one bad batch can't hold the rest back.
import type { SupabaseClient } from "@supabase/supabase-js";
import { replaceOutboxHead } from "./cloud-outbox";
import { withBlobSeal } from "./blob-seal";
import { cardRows, macRowHost } from "./cloud-sync-cards";
import { check, isRowError, upsert } from "./cloud-sync-send";
import { putWithRepo } from "./cloud-cards-repo";
import { lastPerKey, projectItem, publishes } from "./card-rows";
import { scrub } from "./cloud-sync-rows";
import { byOrg, singleRoute, type SyncRoute } from "./cloud-sync-route";
import { sealerFor, type Sealer } from "./sync-seal-upload";
import type { BlobStore, CloudThreadItemRow, CloudToolOutputRow, OutboxEntry } from "./cloud-sync-types";
import { getCard, getThread } from "./store";

// Items per request. A first sync of a long-used folder is tens of thousands of entries.
export const ITEM_CHUNK = 100;

type ItemEntry = Extract<OutboxEntry, { op: "item" }>;

export interface UploadCtx {
  blobs: BlobStore;
  now: () => number;
  // Seals rows with the workspace key (lib/sync-seal-upload.ts); null or absent uploads them plain.
  sealer?: (orgId: string) => Promise<Sealer | null>;
}

// What a flush leaves behind when the server refused some rows for good (bad data, not a bad connection).
export interface Skipped {
  count: number;
  message: string;
}

// scrub and splitToolResult live in lib/cloud-sync-rows.ts, shared with the Weft Worker's publisher.
export { scrub };

// Ships `pending` (compacted, oldest first). `onShipped` hears each batch's item count as it lands, so the
// Sync page counts up during a long upload. A failure throws with whatever shipped already acknowledged.
// `route` names each card's workspace (lib/cloud-sync-route.ts): a team's linked project goes to the team, the rest home.
export async function uploadPending(
  ctx: UploadCtx,
  client: SupabaseClient,
  route: SyncRoute | string,
  pending: OutboxEntry[],
  onShipped: (items: number) => void,
): Promise<Skipped | null> {
  const to = typeof route === "string" ? singleRoute(route) : route;
  const seals = sealsFor(ctx);
  for (const [orgId, entries] of byOrg(pending, to)) {
    const seal = await seals(orgId);
    const cards = (await cardRows(ctx.blobs, orgId, entries, ctx.now(), (id) => seal?.blob(id) ?? null)).map((row) => seal?.card(row) ?? row);
    for (let i = 0; i < cards.length; i += ITEM_CHUNK) await putCards(client, cards.slice(i, i + ITEM_CHUNK));
    if (orgId !== to.home) await leaveHome(client, to.home, cards.map((c) => c.card_id), ctx.now());
  }
  for (const entry of pending) {
    // The row keeps the card json it last uploaded; a card that never synced matches no row. The card is gone, so its
    // folder is too: it is marked deleted in every workspace this Mac sends to.
    if (entry.op === "card_deleted") {
      const at = new Date(ctx.now()).toISOString();
      for (const orgId of to.all()) check(await client.from("cloud_cards").update({ deleted: true, updated_at: at }).eq("org_id", orgId).eq("card_id", entry.cardId));
    }
    if (entry.op === "truncate") {
      check(await client.from("cloud_thread_items").delete().eq("org_id", to.orgOf(entry.cardId)).eq("card_id", entry.cardId).gte("seq", entry.seq));
    }
  }
  // Cards, deletes and truncates are done: leave only the items in the outbox, so each chunk can drop off its head.
  const items = pending.filter((e): e is ItemEntry => e.op === "item");
  replaceOutboxHead(pending.length, items);
  return shipItems({ ...ctx, seals }, client, to, items, onShipped);
}

// Each workspace's sealer, asked once a flush.
function sealsFor(ctx: UploadCtx): (orgId: string) => Promise<Sealer | null> {
  const asked = new Map<string, Promise<Sealer | null>>();
  return (orgId) => {
    if (!asked.has(orgId)) asked.set(orgId, (ctx.sealer ?? sealerFor)(orgId));
    return asked.get(orgId) as Promise<Sealer | null>;
  };
}

// A card that now goes to a team leaves the copy it had at home, so the personal board doesn't keep a stale one.
async function leaveHome(client: SupabaseClient, home: string, cardIds: string[], now: number) {
  if (!cardIds.length) return;
  check(await client.from("cloud_cards").update({ deleted: true, updated_at: new Date(now).toISOString() }).eq("org_id", home).in("card_id", cardIds).eq("deleted", false));
}

// A chunk of cards. When the WAF still blocks it escaped, each card goes alone so only the one it matches
// is held back; items need their card's row, so that one card still fails the flush, now with a readable error.
// A database without cloud_cards.repo yet takes them without it (lib/cloud-cards-repo.ts).
async function putCards(client: SupabaseClient, rows: object[]) {
  const put = (some: object[]) => putWithRepo((sent) => upsert(client, "cloud_cards", sent), some);
  try {
    await put(rows);
  } catch (err) {
    if (!isRowError(err) || rows.length === 1) throw err;
    for (const row of rows) await put([row]);
  }
}

type ShipCtx = UploadCtx & { seals: (orgId: string) => Promise<Sealer | null> };

async function shipItems(ctx: ShipCtx, client: SupabaseClient, route: SyncRoute, items: ItemEntry[], onShipped: (n: number) => void): Promise<Skipped | null> {
  let count = 0;
  let message = "";
  for (let i = 0; i < items.length; i += ITEM_CHUNK) {
    const chunk = items.slice(i, i + ITEM_CHUNK);
    try {
      onShipped(await putRouted(ctx, client, route, chunk));
    } catch (err) {
      if (!isRowError(err)) throw err;
      // The server refused something in this chunk: find it by sending the rest one at a time, and skip it.
      for (const entry of chunk) {
        try {
          onShipped(await putRouted(ctx, client, route, [entry]));
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

// A chunk's items, each to its card's workspace, sealed with that workspace's key.
async function putRouted(ctx: ShipCtx, client: SupabaseClient, route: SyncRoute, entries: ItemEntry[]): Promise<number> {
  let shipped = 0;
  for (const [orgId, group] of byOrg(entries, route)) shipped += await putItems(ctx.blobs, (await ctx.seals(orgId)) ?? undefined, client, orgId, group);
  return shipped;
}

// Tool outputs first, then the items that point at them, each in one upsert. Returns the items shipped. Each row is the
// item's projection (lib/card-rows.ts: redacted and scrubbed), then sealed: the server never sees what redaction would
// have hidden either way. The files an item names go up sealed too, when its row does (Sealer.blob).
async function putItems(blobs: BlobStore, seal: Sealer | undefined, client: SupabaseClient, orgId: string, entries: ItemEntry[]): Promise<number> {
  const items: CloudThreadItemRow[] = [];
  const outputs: CloudToolOutputRow[] = [];
  for (const entry of entries) {
    const card = getCard(entry.cardId);
    const host = macRowHost(orgId, withBlobSeal(blobs, seal?.blob(entry.cardId) ?? null));
    if (!card || !publishes(card, host)) continue;
    const live = getThread(entry.cardId)[entry.seq];
    if (!live) continue;
    const { item, output } = await projectItem(entry.seq, live, host);
    items.push({ org_id: orgId, card_id: entry.cardId, ...item });
    if (output) outputs.push({ org_id: orgId, card_id: entry.cardId, ...output });
  }
  if (outputs.length) await upsert(client, "cloud_tool_outputs", lastPerKey(outputs, (o) => `${o.card_id}/${o.tool_id}`).map((r) => seal?.tool(r) ?? r));
  if (items.length) await upsert(client, "cloud_thread_items", lastPerKey(items, (i) => `${i.card_id}/${i.seq}`).map((r) => seal?.item(r) ?? r));
  return items.length;
}
