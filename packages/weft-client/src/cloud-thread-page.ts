// A synced thread as a ThreadPage (./thread-page.ts), for a client reading cloud_thread_items: weft.zip's thread
// transport and the phone. A row's seq is the item's index in the Mac's thread, so a page of rows is a ThreadPage
// starting at its lowest seq, and a Realtime change is the same update a live "thread" event makes on the desktop. A
// truncate (a rewind, or an edit with ↑) arrives as a DELETE per seq from the cut on; each drops the window from its
// seq down. Opening a sealed item is the caller's (it holds the key): `isItem` and `open` come in as arguments.
import type { ThreadItem } from "./thread-items";
import { applyThreadEvent, type ThreadPage } from "./thread-page";

// The part of a cloud_thread_items row a page reads.
export interface CloudItemRow {
  card_id: string;
  seq: number;
  item: ThreadItem;
}

// One Realtime change to cloud_thread_items, as useWebBoard hands it on.
export interface CloudItemChange {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new?: Partial<CloudItemRow> | null;
  old?: Partial<CloudItemRow> | null;
}

// Whether a row's item arrived whole enough to draw (or to open, when sealed).
export type IsItem = (item: unknown) => item is ThreadItem;
// The item a row draws as: itself, or opened when sealed.
export type OpenItem = (row: CloudItemRow) => ThreadItem;

// A page of one card's rows, in any order, as a ThreadPage. Rows from another card are left out.
export function pageFromItemRows(cardId: string, rows: readonly CloudItemRow[], isItem: IsItem, open: OpenItem): ThreadPage {
  const mine = rows.filter((r) => r.card_id === cardId && isItem(r.item)).toSorted((a, b) => a.seq - b.seq);
  const first = mine[0];
  const last = mine.at(-1);
  if (!first || !last) return { items: [], start: 0, total: 0 };
  return { items: mine.map((r) => open(r)), start: first.seq, total: last.seq + 1 };
}

// Drops the window's items from index `seq` on.
export function cutAt(prev: ThreadPage, seq: number): ThreadPage {
  if (seq >= prev.total) return prev;
  return { items: prev.items.slice(0, Math.max(0, seq - prev.start)), start: Math.min(prev.start, seq), total: seq };
}

// The update a change makes to the open card's window, or null when it's another card's (the channel is the org's).
export function pageUpdateWith(cardId: string, change: CloudItemChange, isItem: IsItem, open: OpenItem): ((prev: ThreadPage) => ThreadPage) | null {
  if (change.eventType === "DELETE") {
    const seq = change.old?.seq;
    if (change.old?.card_id !== cardId || typeof seq !== "number") return null;
    return (prev) => cutAt(prev, seq);
  }
  const row = change.new;
  if (row?.card_id !== cardId || typeof row.seq !== "number" || !isItem(row.item)) return null;
  const event = { index: row.seq, item: open({ card_id: cardId, seq: row.seq, item: row.item }) };
  return (prev) => applyThreadEvent(prev, event);
}
