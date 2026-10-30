// A Weft Worker's outbox: it hears the engine's bus (the same card and thread events a Mac's outbox hears,
// lib/cloud-sync.ts) and ships the cards and their items through the worker_* functions. The rows are built the way
// the Mac builds them: scrubbed for Postgres (scrub), redacted (redactValue), long tool results cut out to
// cloud_tool_outputs (splitToolResult), so the web board draws a worker's card exactly like a Mac's.
//
// Kept in memory, not in a file: a worker that restarts mid-turn has lost the turn anyway, and the next event on a
// card re-sends it. With `pages`, a page or image a card names goes up as a blob first (lib/worker-blobs.ts), the way
// the Mac's flush does it: the row's copy carries the ref, the card on the worker keeps its path, and a file that
// can't go up stays a path. A failed upload never holds back the thread.
import path from "node:path";
import type { BlobStoreBundle } from "./blob-store";
import { withUploadedPage } from "./cloud-sync-cards";
import { scrub, splitToolResult } from "./cloud-sync-rows";
import { redactValue } from "./cloud-sync-redact";
import type { CloudCardRow } from "./cloud-sync-types";
import type { Card, ThreadItem } from "./types";
import type { BoardEvent } from "./types-card";
import type { ItemRow, OutputRow, Registry } from "./worker-registry";

export interface PublishSource {
  getCard(id: string): Card | undefined;
  getThread(id: string): ThreadItem[];
}

interface Dirty {
  card: boolean;
  deleted: boolean;
  seqs: Set<number>;
  // The lowest seq a rewind dropped from, since the last flush.
  fromSeq: number | null;
}

export interface PublishedPages {
  blobs: Pick<BlobStoreBundle, "refFor" | "upload" | "uploadPage" | "rewriteItem">;
  orgId: string;
}

export function createPublisher(reg: Pick<Registry, "putCard" | "putItems">, source: PublishSource, log: (msg: string) => void = console.warn, pages?: PublishedPages) {
  const dirty = new Map<string, Dirty>();
  // The folder name a card's command named ("weft"), so the web board shows the project, not the worker's path.
  const folders = new Map<string, string>();
  let flushing: Promise<void> | null = null;

  const mark = (id: string) => {
    let d = dirty.get(id);
    if (!d) dirty.set(id, (d = { card: false, deleted: false, seqs: new Set(), fromSeq: null }));
    return d;
  };

  function hear(event: BoardEvent) {
    if (event.type === "card") {
      if (event.card.role !== "copilot") mark(event.card.id).card = true;
    } else if (event.type === "card_deleted") {
      mark(event.id).deleted = true;
    } else if (event.type === "thread") {
      const d = mark(event.cardId);
      d.seqs.add(event.index);
      if (event.truncate) d.fromSeq = Math.min(d.fromSeq ?? Infinity, event.index + 1);
    }
  }

  const folderOf = (card: Card) => folders.get(card.id) ?? path.basename(card.cwd);

  async function cardToSend(card: Card): Promise<Card> {
    if (!pages) return card;
    try {
      return (await withUploadedPage({ card } as CloudCardRow, pages.blobs, pages.orgId)).card;
    } catch (err) {
      log(`Weft Worker: couldn't upload ${card.id}'s page: ${(err as Error).message}`);
      return card;
    }
  }

  async function itemToSend(item: ThreadItem): Promise<ThreadItem> {
    if (!pages) return item;
    try {
      return await pages.blobs.rewriteItem(item, pages.orgId);
    } catch (err) {
      log(`Weft Worker: couldn't upload a file: ${(err as Error).message}`);
      return item;
    }
  }

  async function ship(id: string, d: Dirty) {
    const card = source.getCard(id);
    if (d.deleted) return reg.putCard(id, folders.get(id) ?? "", {}, true);
    if (!card) return;
    // Every flush sends the card first: an item can only land on a card row that exists.
    await reg.putCard(id, folderOf(card), scrub(redactValue(await cardToSend(card))), false);
    const thread = source.getThread(id);
    const items: ItemRow[] = [];
    const outputs: OutputRow[] = [];
    for (const seq of [...d.seqs].sort((a, b) => a - b)) {
      const live = thread[seq];
      if (!live) continue;
      const { item, output } = splitToolResult(await itemToSend(live));
      items.push(scrub({ seq, kind: item.kind, item: redactValue(item), at: new Date(live.at).toISOString() }));
      if (output) outputs.push(scrub({ ...output, result: redactValue(output.result) }));
    }
    if (items.length || outputs.length || d.fromSeq !== null) await reg.putItems(id, items, outputs, d.fromSeq);
  }

  async function drain() {
    while (dirty.size) {
      const batch = [...dirty];
      dirty.clear();
      for (const [id, d] of batch) {
        try {
          await ship(id, d);
        } catch (err) {
          log(`Weft Worker: couldn't publish ${id}: ${(err as Error).message}`);
        }
      }
    }
  }

  // Ships what's dirty; a flush that's already running is joined, then one more runs for what came in meanwhile.
  async function flush(): Promise<void> {
    if (flushing) await flushing;
    if (!dirty.size) return;
    flushing = drain().finally(() => (flushing = null));
    return flushing;
  }

  return {
    hear,
    flush,
    nameFolder: (cardId: string, folder: string) => void folders.set(cardId, folder),
    // Marks a card so the next flush sends it whole (the card row, then every item it has).
    track(cardId: string) {
      const d = mark(cardId);
      d.card = true;
      source.getThread(cardId).forEach((_, i) => d.seqs.add(i));
    },
  };
}

export type Publisher = ReturnType<typeof createPublisher>;
