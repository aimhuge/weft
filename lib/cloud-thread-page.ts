// A synced thread as the desktop's ThreadView pages it (lib/thread-page.ts), for weft.zip's thread transport
// (components/web-board/useCloudTransport.ts). A cloud_thread_items row's seq is the item's index in the Mac's
// thread, so a page of rows is a ThreadPage starting at its lowest seq, and a Realtime change is the same update a
// live "thread" event makes on the desktop. A truncate (a rewind, or an edit with ↑) arrives as a DELETE per seq from
// the cut on; each drops the window from its seq down.
import type { CloudThreadItemRow } from "./cloud-sync-types";
import { isSealed } from "./sync-seal";
import { applyThreadEvent, type ThreadPage } from "./thread-page";
import { openSyncedItem } from "./web-sync-key";
import type { ThreadItem } from "./types";

type Row = Pick<CloudThreadItemRow, "card_id" | "seq" | "item">;

// One Realtime change to cloud_thread_items, as useWebBoard hands it on.
export interface CloudItemChange {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new?: Partial<Row> | null;
  old?: Partial<Row> | null;
}

// A row whose item didn't arrive whole (a partial event, an older shape) is left out rather than drawn.
// A sealed one (lib/sync-seal.ts) is opened with this browser's key, or drawn as its 🔒 stand-in.
const isItem = (item: unknown): item is ThreadItem => typeof item === "object" && item !== null && ("kind" in item || isSealed(item));

// A page of one card's rows, in any order, as a ThreadPage. Rows from another card are left out.
export function pageFromRows(cardId: string, rows: readonly Row[]): ThreadPage {
  const mine = rows.filter((r) => r.card_id === cardId && isItem(r.item)).toSorted((a, b) => a.seq - b.seq);
  const first = mine[0];
  const last = mine.at(-1);
  if (!first || !last) return { items: [], start: 0, total: 0 };
  return { items: mine.map((r) => openSyncedItem(r)), start: first.seq, total: last.seq + 1 };
}

// Drops the window's items from index `seq` on.
function cutAt(prev: ThreadPage, seq: number): ThreadPage {
  if (seq >= prev.total) return prev;
  return { items: prev.items.slice(0, Math.max(0, seq - prev.start)), start: Math.min(prev.start, seq), total: seq };
}

// The update a change makes to the open card's window, or null when it's another card's (the channel is the org's).
export function pageUpdateFor(cardId: string, change: CloudItemChange): ((prev: ThreadPage) => ThreadPage) | null {
  if (change.eventType === "DELETE") {
    const seq = change.old?.seq;
    if (change.old?.card_id !== cardId || typeof seq !== "number") return null;
    return (prev) => cutAt(prev, seq);
  }
  const row = change.new;
  if (row?.card_id !== cardId || typeof row.seq !== "number" || !isItem(row.item)) return null;
  const event = { index: row.seq, item: openSyncedItem({ card_id: cardId, seq: row.seq, item: row.item }) };
  return (prev) => applyThreadEvent(prev, event);
}
