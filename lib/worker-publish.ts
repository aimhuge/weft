// A Weft Worker's outbox: it hears the engine's bus (the same card and thread events a Mac's outbox hears,
// lib/cloud-sync.ts) and ships the cards and their items through the worker_* functions. The rows are the same
// projection the Mac's flush sends (lib/card-rows.ts: redacted, scrubbed, long tool results cut out to
// cloud_tool_outputs), so the web board draws a worker's card exactly like a Mac's. The worker's own choices are its
// RowHost: no thumbs (no pane), and a failed upload is logged and keeps the path.
//
// Kept in memory, not in a file: a worker that restarts mid-turn has lost the turn anyway, and the next event on a
// card re-sends it. With `pages`, a page or image a card names goes up as a blob first (lib/worker-blobs.ts), the way
// the Mac's flush does it: the row's copy carries the ref, the card on the worker keeps its path, and a file that
// can't go up stays a path. A failed upload never holds back the thread.
import path from "node:path";
import type { BlobStoreBundle } from "./blob-store";
import { lastPerKey, projectCard, projectItem, publishes, type RowHost } from "./card-rows";
import type { LineEvent } from "./host-line-protocol";
import { createDeltaStream } from "./line-deltas";
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
  // The worker's side of each difference between the hosts (lib/card-rows.ts).
  const host: RowHost = {
    orgId: pages?.orgId ?? "",
    blobs: pages?.blobs,
    thumbs: false,
    copilot: false,
    onBlobError: (err, what) => log(`Weft Worker: couldn't upload ${what}: ${err.message}`),
  };

  const mark = (id: string) => {
    let d = dirty.get(id);
    if (!d) dirty.set(id, (d = { card: false, deleted: false, seqs: new Set(), fromSeq: null }));
    return d;
  };

  // Session lines hear what the rows get, projected and uploaded once (lib/host-line.ts): never a card that was never
  // published, so the copilot's delete stays off them as its card does.
  const mirrors = new Set<(event: LineEvent) => void>();
  const shipped = new Set<string>();
  const mirror = (event: LineEvent) => mirrors.forEach((fn) => fn(event));
  // A reply as it streams, only to lines (the rows get the item), redacted and coalesced (lib/line-deltas.ts).
  const deltas = createDeltaStream(mirror, (id) => source.getThread(id).length);
  const streams = (id: string) => {
    const card = mirrors.size ? source.getCard(id) : undefined;
    return Boolean(card && publishes(card, host));
  };

  function hear(event: BoardEvent) {
    if (event.type === "card") {
      if (publishes(event.card, host)) mark(event.card.id).card = true;
    } else if (event.type === "card_deleted") {
      deltas.end(event.id);
      mark(event.id).deleted = true;
    } else if (event.type === "delta") {
      if (streams(event.cardId)) deltas.add(event.cardId, event.text);
    } else if (event.type === "thread") {
      // A finished reply ends the streaming text, as on a Mac's board (lib/board-live.ts).
      if (event.item.kind === "assistant" || event.item.kind === "result") deltas.end(event.cardId);
      const d = mark(event.cardId);
      d.seqs.add(event.index);
      if (event.truncate) d.fromSeq = Math.min(d.fromSeq ?? Infinity, event.index + 1);
    }
  }

  const folderOf = (card: Card) => folders.get(card.id) ?? path.basename(card.cwd);


  async function ship(id: string, d: Dirty) {
    const card = source.getCard(id);
    if (d.deleted) {
      if (shipped.delete(id)) mirror({ t: "card_deleted", id });
      return reg.putCard(id, folders.get(id) ?? "", {}, true);
    }
    // The copilot's thread events used to ship its card and items even though its card events didn't.
    if (!card || !publishes(card, host)) return;
    // Every flush sends the card first: an item can only land on a card row that exists.
    const projected = (await projectCard(card, host)).card;
    shipped.add(id);
    mirror({ t: "card", card: projected });
    await reg.putCard(id, folderOf(card), projected, false);
    const thread = source.getThread(id);
    const items: ItemRow[] = [];
    const outputs: OutputRow[] = [];
    for (const seq of [...d.seqs].sort((a, b) => a - b)) {
      const live = thread[seq];
      if (!live) continue;
      const { item, output } = await projectItem(seq, live, host);
      // The lowest item a rewind replaced drops what followed it, on the board as in the rows.
      mirror({ t: "thread", cardId: id, index: seq, item: item.item, ...(d.fromSeq !== null && seq === d.fromSeq - 1 ? { truncate: true } : {}) });
      items.push(item);
      if (output) outputs.push(output);
    }
    // worker_put_items is one INSERT ... ON CONFLICT, which refuses a batch naming one tool id twice (Codex's "item_1").
    const unique = lastPerKey(outputs, (o) => o.tool_id);
    if (items.length || unique.length || d.fromSeq !== null) await reg.putItems(id, items, unique, d.fromSeq);
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
    // Every card and item as it ships, for the session lines' `events`; the returned function stops hearing.
    mirror(fn: (event: LineEvent) => void) {
      mirrors.add(fn);
      return () => void mirrors.delete(fn);
    },
    nameFolder: (cardId: string, folder: string) => void folders.set(cardId, folder),
    // Marks a card so the next flush sends its row, for a card whose row may be out of date but whose items aren't.
    touch: (cardId: string) => void (mark(cardId).card = true),
    // Marks a card so the next flush sends it whole (the card row, then every item it has).
    track(cardId: string) {
      const d = mark(cardId);
      d.card = true;
      source.getThread(cardId).forEach((_, i) => d.seqs.add(i));
    },
  };
}

export type Publisher = ReturnType<typeof createPublisher>;
