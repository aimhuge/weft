// A synced thread as the desktop's ThreadView pages it, for weft.zip's thread transport
// (components/web-board/useCloudTransport.ts). The paging itself lives in @weft/client
// (packages/weft-client/src/cloud-thread-page.ts); this edge adds the browser's side: a sealed item (lib/sync-seal.ts)
// is opened with this browser's key, or drawn as its 🔒 stand-in.
import { pageFromItemRows, pageUpdateWith, type CloudItemChange, type CloudItemRow, type ThreadPage } from "@weft/client";
import { isSealed } from "./sync-seal";
import { openSyncedItem } from "./web-sync-key";
import type { ThreadItem } from "./types";

export type { CloudItemChange };

// A row whose item didn't arrive whole (a partial event, an older shape) is left out rather than drawn.
const isItem = (item: unknown): item is ThreadItem => typeof item === "object" && item !== null && ("kind" in item || isSealed(item));

// A page of one card's rows, in any order, as a ThreadPage. Rows from another card are left out.
export function pageFromRows(cardId: string, rows: readonly CloudItemRow[]): ThreadPage {
  return pageFromItemRows(cardId, rows, isItem, openSyncedItem);
}

// The update a change makes to the open card's window, or null when it's another card's (the channel is the org's).
export function pageUpdateFor(cardId: string, change: CloudItemChange): ((prev: ThreadPage) => ThreadPage) | null {
  return pageUpdateWith(cardId, change, isItem, openSyncedItem);
}
