// One card schema (docs/architecture/project-hosts.md#devices-and-records): the cloud rows are a projection of the
// host's Card and its thread items, made here for both hosts. A Mac's flush (lib/cloud-sync-upload.ts) and a Weft
// Worker's publisher (lib/worker-publish.ts) call it; each keeps its own identity (owner_device, folder) and transport
// (a direct upsert with the account's session, or the worker_put_card / worker_put_items RPCs), and seals what this
// returns with its own Sealer, if it has one. The steps, in order:
//
//   card ─ thumb up as a blob (thumbs) ─ page up as a blob ─ tour pages up as blobs ─ redact ─ scrub ─▶ CardProjection ─ host's seal ─▶ row
//   item ─ local paths up as blobs ─ splitToolResult ─ redact ─ scrub ─▶ ItemProjection ─ host's seal ─▶ rows
//
// Where the two hosts still differ, the difference is a field of RowHost, not a second copy of the code.
import { withUploadedPage, withUploadedThumbs } from "./card-rows-blobs";
import { redactValue } from "./cloud-sync-redact";
import { scrub, splitToolResult } from "./cloud-sync-rows";
import { withUploadedTour } from "./review-blobs";
import type { BlobStore, CloudCardRow } from "./cloud-sync-types";
import { redactText } from "./share-redact";
import { stripEnvBlock } from "./env-block";
import type { Card, ThreadItem } from "./types";

export interface RowHost {
  orgId: string;
  // Where pages, thumbs and the files an item names go up. Without it every path stays a path.
  blobs?: Pick<BlobStore, "upload" | "uploadPage" | "rewriteItem">;
  // Send card.thumb up as a blob too, and fill page_thumb. A Mac: its pane captures one after every turn. A worker
  // has no pane, so false keeps what it always sent.
  thumbs: boolean;
  // Set: a failed upload is logged and the row keeps the path (a worker never holds its thread back for a blob).
  // Unset: the error throws, so a Mac's flush backs off and tries again with the entries kept.
  onBlobError?: (err: Error, what: string) => void;
  // Publish the copilot's card. A Mac syncs it like any card whose folder (home) is opted in; a worker never does,
  // and both boards drop a worker's copilot row (lib/worker-board.ts).
  copilot: boolean;
}

// Whether this host publishes the card at all: its row and its items.
export const publishes = (card: Card, host: Pick<RowHost, "copilot">) => host.copilot || card.role !== "copilot";

// The card as its row carries it, with the columns a feed reads without the thread
// (docs/architecture/cloud-sync.md#the-cards-page).
export interface CardProjection {
  card: Card;
  page: string | null;
  page_thumb: string | null;
  pages: number;
}

export interface ItemProjection {
  item: { seq: number; kind: ThreadItem["kind"]; item: ThreadItem; at: string };
  output?: { tool_id: string; result: string; bytes: number };
}

async function guarded<T>(host: RowHost, what: string, fallback: T, run: () => Promise<T>): Promise<T> {
  if (!host.onBlobError) return run();
  try {
    return await run();
  } catch (err) {
    host.onBlobError(err as Error, what);
    return fallback;
  }
}

async function withBlobs(card: Card, host: RowHost): Promise<CardProjection> {
  const plain: CardProjection = { card, page: null, page_thumb: null, pages: card.pages ?? 0 };
  const blobs = host.blobs;
  if (!blobs) return plain;
  const store = blobs as BlobStore;
  return guarded(host, `${card.id}'s page`, plain, async () => {
    const row = { org_id: host.orgId, card } as CloudCardRow;
    const [thumbed = row] = host.thumbs ? await withUploadedThumbs([row], store, host.orgId) : [row];
    const { card: paged, page = null, page_thumb = null, pages = 0 } = await withUploadedPage(thumbed, store, host.orgId);
    const sent = await withUploadedTour(paged, store, host.orgId);
    return { card: sent, page, page_thumb: host.thumbs ? page_thumb : null, pages };
  });
}

// The card's projection: free text redacted (ids and paths kept, lib/cloud-sync-redact.ts) and scrubbed for Postgres.
// The page column is the redacted card's page, so a key in a page's URL can't reach the row through it.
export async function projectCard(card: Card, host: RowHost): Promise<CardProjection> {
  const up = await withBlobs(card, host);
  const redacted = redactValue(up.card);
  return scrub({ ...up, card: redacted, page: up.page && redactValue({ page: up.page }).page });
}

// A user item never holds the <weft-env> block (the runner adds it only to what the CLI gets, lib/turn-env.ts), but a
// thread read back from a transcript could: the rows, and so weft.zip and share links, never carry it.
function withoutEnv(item: ThreadItem): ThreadItem {
  return item.kind === "user" && item.text.includes("<weft-env>") ? { ...item, text: stripEnvBlock(item.text) } : item;
}

// One thread item's projection, with its long tool result cut out to the output row.
export async function projectItem(seq: number, given: ThreadItem, host: RowHost): Promise<ItemProjection> {
  const live = withoutEnv(given);
  const blobs = host.blobs;
  const rewritten = blobs ? await guarded(host, "a file", live, () => blobs.rewriteItem(live, host.orgId)) : live;
  const { item, output } = splitToolResult(rewritten);
  const row = scrub({ seq, kind: item.kind, item: redactValue(item), at: new Date(live.at).toISOString() });
  return output ? { item: row, output: scrub({ ...output, result: redactText(output.result) }) } : { item: row };
}

// One row per primary key in a request: Postgres refuses an upsert that names a row twice ("ON CONFLICT DO UPDATE
// command cannot affect row a second time"). Codex reuses tool ids like "item_1" from turn to turn, so a batch can
// hold two outputs for one key; the later one wins, as it would across requests.
export function lastPerKey<T>(rows: T[], key: (row: T) => string): T[] {
  return [...new Map(rows.map((row) => [key(row), row])).values()];
}
