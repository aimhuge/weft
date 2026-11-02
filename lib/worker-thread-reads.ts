// Two reads a worker card's open thread makes on the desktop board, beside its pages (lib/worker-board.ts
// workerThreadPage), through app/api/worker-board as the signed-in account, so RLS decides:
//
// - workerThreadSearch: ⌘F over the whole thread (lib/thread-find.ts), not just the loaded window. The card's
//   cloud_thread_items rows are read in pages and matched here, as app/api/cards/[id]/thread/search does over the local
//   store. A sealed row (lib/sync-seal.ts) has no key on this server and is drawn as its 🔒 stand-in, so it matches
//   nothing; a long tool result left out of its item (cloud_tool_outputs) isn't searched.
// - workerBlobUrls: the URLs a thread's pictures load from. A synced item names an image by its blob ref
//   (`blob:sha256:<hex>`), which no <img> can load, so the thread view asks for them signed, the way the web board
//   signs its own (lib/blob-urls.ts resolveBlobUrls), and draws them with lib/worker-blob-view.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { resolveBlobUrls } from "./blob-urls";
import { isBlobRef } from "./cloud-sync-types";
import { syncOrgId } from "./cloud-sync";
import { isSealed } from "./sync-seal";
import { matchThread, type FindMatch } from "./thread-find";
import type { ThreadItem } from "./types";

// Rows per read, and the most a search walks: a thread longer than that is searched over its first SEARCH_MAX items.
export const SEARCH_PAGE = 1000;
export const SEARCH_MAX = 20_000;
// The most refs one read signs.
export const BLOB_REFS_MAX = 200;

// The workspace the signed-in account syncs to, or null when signed out.
async function accountOrg(client: SupabaseClient): Promise<string | null> {
  const { data } = await client.auth.getSession();
  const uid = data.session?.user.id;
  return uid ? syncOrgId(client, uid) : null;
}

// A row's item as find reads it: a sealed one (no key here) or one that isn't an item reads as a hole.
function findable(item: unknown): ThreadItem | null {
  if (isSealed(item)) return null;
  return typeof item === "object" && item !== null && "kind" in item ? (item as ThreadItem) : null;
}

// The items holding `query` in a worker card's whole thread, by their index (seq); null when it can't be read.
export async function workerThreadSearch(cardId: string, query: string, client: SupabaseClient = accountClient()): Promise<FindMatch[] | null> {
  if (!query) return [];
  const org = await accountOrg(client);
  if (!org) return null;
  const items: (ThreadItem | null)[] = [];
  for (let from = 0; from < SEARCH_MAX; from += SEARCH_PAGE) {
    const { data, error } = await client.from("cloud_thread_items").select("seq, item").eq("org_id", org).eq("card_id", cardId).order("seq", { ascending: true }).range(from, from + SEARCH_PAGE - 1);
    if (error) return null;
    const rows = data as { seq: number; item: unknown }[];
    for (const row of rows) items[row.seq] = findable(row.item);
    if (rows.length < SEARCH_PAGE) break;
  }
  return matchThread(items, query);
}

// A ref → URL table for the refs a thread view names; the ones nobody can sign are left out. Empty when signed out.
export async function workerBlobUrls(refs: readonly string[], client: SupabaseClient = accountClient()): Promise<Record<string, string>> {
  const wanted = [...new Set(refs.filter(isBlobRef))].slice(0, BLOB_REFS_MAX);
  if (!wanted.length) return {};
  const org = await accountOrg(client);
  return org ? resolveBlobUrls(client, org, wanted) : {};
}
