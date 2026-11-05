// The share viewer's page-of-thread builder (lib/share-types.ts): turns cloud_thread_items rows into
// a ShareLive the page and the live poll both consume. Paging matches the desktop's own thread
// route (lib/thread-page.ts, lib/cloud-sync.ts): newest first, THREAD_PAGE_SIZE per page, a `before`
// cursor for "Load earlier", no cursor for "give me the newest". Items are redacted; the pane is
// computed over the WHOLE thread so the latest open_url wins even if it's outside the current page;
// every blob ref a session hits (items + pane + card.thumb) gets a URL through the service client:
// presigned R2 when the blob is copied there, a one-hour Supabase signed URL otherwise (lib/blob-urls.ts).
//
// Everything here is pure except the two Supabase reads (thread items + pane probe), so a test can
// stub the service client and assert the page shape without the database.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { THREAD_PAGE_SIZE, type CloudThreadItemRow } from "./cloud-sync-types";
import { resolveBlobUrls } from "./blob-urls";
import { collectBlobRefs } from "./web-board";
import { queueMirror } from "./r2-queue";
import { paneFor, type ShareLive, type SharePane } from "./share-types";
import { redactItems } from "./share-redact";
import { publicPane, toShareCard } from "./share-view";
import type { ThreadItem } from "./types";

type ShareThreadRow = CloudThreadItemRow;

const PANE_PROBE_LIMIT = 200;
// Reject obvious pagination: it loads the newest page when neither cursor is set, "earlier" when
// `before` is set, "newer than" when `after` is set. A non-integer cursor answers false; an out-of-
// range cursor is clamped on the server side by the query's natural ordering.
export type ShareCursor = "newest" | "older" | "newer";

// Read the right slice of cloud_thread_items for `cursor`. `before` and `after` are exclusive seq
// boundaries; the `after` fetch returns rows whose seq is greater, oldest first (the viewer flips
// to newest-first before sending). The returned shape is what the page and the poll both render.
export async function loadThreadPage(
  service: SupabaseClient,
  orgId: string,
  cardId: string,
  cursor: ShareCursor,
  edge?: number,
): Promise<{ rows: ShareThreadRow[]; hasOlder: boolean }> {
  // Supabase's chained filter types lose their narrow type after .overrideTypes(); cast the
  // builder to an untyped view so .lt / .gt are accessible (the actual Postgrest type at runtime
  // exposes them; the static type after overrideTypes is the terminal PostgrestBuilder).
  const base = buildBaseQuery(service, orgId, cardId);
  type FilterView = { lt: (col: string, v: number) => unknown; gt: (col: string, v: number) => unknown };
  const filters = base as unknown as FilterView;
  const query: unknown = cursor === "older" && typeof edge === "number"
    ? filters.lt("seq", edge)
    : cursor === "newer" && typeof edge === "number"
      ? filters.gt("seq", edge)
      : base;
  const { data, error } = await (query as PromiseLike<{ data: ShareThreadRow[]; error: unknown }>);
  if (error) return { rows: [], hasOlder: false };
  return { rows: data, hasOlder: data.length >= THREAD_PAGE_SIZE };
}

function buildBaseQuery(service: SupabaseClient, orgId: string, cardId: string) {
  return service
    .from("cloud_thread_items")
    .select("*")
    .eq("org_id", orgId)
    .eq("card_id", cardId)
    .order("seq", { ascending: false })
    .limit(THREAD_PAGE_SIZE)
    .overrideTypes<ShareThreadRow[]>();
}

// The newest pane across the WHOLE thread, not just the visible window: the thread page may be
// older than the latest open_url. A small probe (PANE_PROBE_LIMIT) is plenty — the visible pane is
// almost always in the newest page; the probe catches "the viewer opened the thread and the thread
// has gone quiet for a while" without scanning the whole history.
export async function loadPaneAcrossThread(
  service: SupabaseClient,
  orgId: string,
  cardId: string,
): Promise<SharePane | null> {
  const { data, error } = await service
    .from("cloud_thread_items")
    .select("item, at, seq")
    .eq("org_id", orgId)
    .eq("card_id", cardId)
    .order("seq", { ascending: false })
    .limit(PANE_PROBE_LIMIT)
    .overrideTypes<{ item: ThreadItem; at: string; seq: number }[]>();
  if (error) return null;
  const items = data.map((r) => r.item);
  return paneFor(items);
}

// Build the final ShareLive for one share. `after`/`before` mirror the URL query; the response is
// shaped so the poll's merge logic can diff two ShareLives by seq without re-walking the rows.
// `card` is the row from loadShare (lib/share-access.ts); the redactor already ran on the thread
// items, and blob URLs are signed for an hour so an idle tab can keep rendering.
export interface BuildShareLiveOptions {
  service: SupabaseClient;
  orgId: string;
  cardId: string;
  card: unknown;
  after?: number;
  before?: number;
  // The share's show_chat: false sends no items at all, only the card and its pane.
  showChat?: boolean;
}

export async function buildShareLive(opts: BuildShareLiveOptions): Promise<ShareLive> {
  const cursor: ShareCursor = typeof opts.after === "number" ? "newer" : typeof opts.before === "number" ? "older" : "newest";
  const edge = cursor === "newer" ? opts.after : cursor === "older" ? opts.before : undefined;
  const showChat = opts.showChat !== false;
  const { rows, hasOlder } = showChat
    ? await loadThreadPage(opts.service, opts.orgId, opts.cardId, cursor, edge)
    : { rows: [], hasOlder: false };
  // `newer` fetches oldest-first (seq > after), but the API contract is "newest first" so a poll
  // can drop the result on the front of its list. Flip the order here.
  const orderedRows = cursor === "newer" ? rows.slice().reverse() : rows;
  const items = orderedRows.map((row) => ({ seq: row.seq, item: row.item }));
  const redactedItems = redactItems(items.map((i) => i.item));
  const stamped = items.map((i, idx) => ({ seq: i.seq, item: redactedItems[idx] as ThreadItem }));
  // The pane comes from the whole thread, not just the visible window.
  const pane = await loadPaneAcrossThread(opts.service, opts.orgId, opts.cardId);
  // Collect every ref the page will fetch: every item, the pane's blob ref (if any), the card's
  // thumb (if it's a blob ref).
  const refs = new Set<string>();
  collectBlobRefs(stamped.map((s) => s.item), refs);
  collectPaneBlobRef(pane, refs);
  collectThumbBlobRef(opts.card, refs);
  const blobUrls = await resolveBlobUrls(opts.service, opts.orgId, [...refs], { onUnmirrored: queueMirror(opts.orgId) });
  // The blob URLs map (one hour) covers every ref the page will fetch. The pane's `url` field
  // (for site/local kinds) stays as-is — there's no blob to sign for those.
  return {
    card: toShareCard(opts.card),
    items: stamped,
    hasOlder,
    pane: publicPane(pane),
    blobUrls,
    showChat,
  };
}

function collectPaneBlobRef(pane: SharePane | null, refs: Set<string>): void {
  if (!pane || pane.kind !== "blob") return;
  refs.add(pane.ref);
}

function collectThumbBlobRef(card: unknown, refs: Set<string>): void {
  if (!card || typeof card !== "object") return;
  const thumb = (card as { thumb?: unknown }).thumb;
  if (typeof thumb === "string" && thumb.startsWith("blob:sha256:")) refs.add(thumb);
}

// Re-exported so the route can import a single function for the `cursor` type.
export type { ShareCursor as ShareLiveCursor };