// Server-side cards: the rows Weft uploads to Supabase and the seams between its parts.
// The outbox (lib/cloud-sync.ts) turns bus events into these rows, the blob store (lib/blob-store.ts) swaps local
// paths for content hashes, and supabase/migrations/*_card_sync.sql holds the tables. Sync is opt-in per folder
// (settings `syncFolders`) and off by default; the Mac running a card owns it, other devices only read.
import type { Card, ThreadItem } from "./types";

// The inline cap on a tool result and the thread route's page size live with the paging, in @weft/client.
export { TOOL_RESULT_INLINE_MAX, THREAD_PAGE_SIZE } from "@weft/client";

// Images, attachments and ~/.weft/show pages, stored once each by content.
export const BLOB_BUCKET = "weft-blobs";
// The ref's shape is @weft/client's, so a pane or thread item on the phone reads it the same.
import { BLOB_REF_PREFIX, type BlobRef } from "@weft/client";
export { BLOB_REF_PREFIX, type BlobRef };

export function isBlobRef(value: string): value is BlobRef {
  return /^blob:sha256:[0-9a-f]{64}$/.test(value);
}

// public.cloud_cards: one row per synced card, upserted on every change.
export interface CloudCardRow {
  org_id: string;
  card_id: string;
  // The Mac that runs this card (lib/device-id.ts). Other devices read it and queue replies.
  owner_device: string;
  // The account that runs it; the database fills it in (auth.uid()), the outbox never sends it. The web board
  // reads it to offer only the folders of the Macs you own as places to start a card.
  owner_user?: string;
  folder: string;
  card: Card;
  deleted: boolean;
  updated_at: string;
  // The card's current pane page, so a feed draws it without its thread (docs/architecture/cloud-sync.md#the-cards-page):
  // a blob ref with its #anchor, an https URL, or a URL only the owner's Mac reaches, with page_thumb (the pane capture) for that.
  page?: string | null;
  page_thumb?: string | null;
  pages?: number;
}

// public.cloud_thread_items: one row per thread item, keyed by its index in the thread.
// item is the ThreadItem with long tool results cut out and local paths rewritten to blob refs.
export interface CloudThreadItemRow {
  org_id: string;
  card_id: string;
  seq: number;
  kind: ThreadItem["kind"];
  item: ThreadItem;
  at: string;
}

// public.cloud_tool_outputs: the full result of a tool call whose result was cut out of its item.
export interface CloudToolOutputRow {
  org_id: string;
  card_id: string;
  tool_id: string;
  result: string;
  bytes: number;
}

// What the outbox queues in ~/.weft/sync-outbox.jsonl, one per line, until it's uploaded.
export type OutboxEntry =
  | { op: "card"; cardId: string; at: number }
  | { op: "card_deleted"; cardId: string; at: number }
  | { op: "item"; cardId: string; seq: number; at: number }
  // Items from seq on were dropped (a rewind or an edit with ↑).
  | { op: "truncate"; cardId: string; seq: number; at: number };

// The blob store's face to the outbox.
export interface BlobStore {
  // sha256 of a local file as a ref, or null if it doesn't exist.
  refFor(localPath: string): Promise<BlobRef | null>;
  // Uploads the file to weft-blobs/<orgId>/<sha> unless it's already there; returns its ref.
  upload(localPath: string, orgId: string): Promise<BlobRef | null>;
  // Uploads a page the pane showed: an HTML file with the local images it names uploaded too and swapped for refs
  // (lib/blob-page-assets.ts). A store without it (a test fake) uploads the page as it is.
  uploadPage?(localPath: string, orgId: string): Promise<BlobRef | null>;
  // The item with each local path it names (attachments, images, ~/.weft/show pages) swapped for a blob ref,
  // uploading as it goes. Returns the item unchanged when nothing in it points at a local file.
  rewriteItem(item: ThreadItem, orgId: string): Promise<ThreadItem>;
}
