// ⌘F over a whole synced thread on weft.zip (lib/thread-transport.ts searchThread), not only the pages loaded: the
// desktop searches the stored thread on its server (app/api/cards/[id]/thread/search), but a synced row may be sealed
// (lib/sync-seal.ts) and only this browser holds the key, so the rows come down in batches and are opened and matched
// here, each at its own seq, which is its index in the Mac's thread.
import type { CloudThreadItemRow } from "./cloud-sync-types";
import { pageFromRows } from "./cloud-thread-page";
import { matchThread, type FindMatch } from "./thread-find";

type Row = Pick<CloudThreadItemRow, "card_id" | "seq" | "item">;

export const SEARCH_BATCH = 1000;
// A thread longer than this is searched up to here: find stays a keystroke, not a download.
export const SEARCH_MAX = 20_000;

// read(after): the card's rows past seq `after`, oldest first, at most SEARCH_BATCH; null when they can't be read.
export async function searchCloudThread(cardId: string, query: string, read: (after: number) => Promise<Row[] | null>): Promise<FindMatch[] | null> {
  if (!query) return [];
  const matches: FindMatch[] = [];
  let after = -1;
  for (let seen = 0; seen < SEARCH_MAX; ) {
    const rows = await read(after);
    if (!rows) return null;
    for (const row of rows) {
      const page = pageFromRows(cardId, [row]);
      matches.push(...matchThread(page.items, query, page.start));
    }
    seen += rows.length;
    const last = rows.at(-1);
    if (!last || rows.length < SEARCH_BATCH) break;
    after = last.seq;
  }
  return matches;
}
