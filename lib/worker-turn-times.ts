// When each turn on your worker cards ended, for the streak and XP (lib/worker-activity.ts): a card's turns used to
// count on its last active day alone, so a worker card that ran across several days kept the streak for one of them.
// A turn ends with a `result` item, and its row in cloud_thread_items carries `kind` and `at` as plain columns even
// when the worker seals the item (lib/sync-seal.ts seals only `item`), so the times are read without opening anything.
// Read as you, through the account's own client, so RLS decides; only the cards asked for, in pages, up to a cap.
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { syncOrgId } from "./cloud-sync";

// Cards per query (their ids ride in the URL), rows per page, and the most rows one read takes.
export const TURN_CARDS = 100;
export const TURN_PAGE = 1000;
export const TURN_ROWS_MAX = 20_000;

/** card id → when each of its turns ended (ms), oldest first; empty when signed out or nothing can be read. */
export async function workerTurnTimes(cardIds: readonly string[], client: SupabaseClient = accountClient()): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (!cardIds.length) return out;
  const { data } = await client.auth.getSession();
  const uid = data.session?.user.id;
  const org = uid ? await syncOrgId(client, uid) : null;
  if (!org) return out;
  let rows = 0;
  for (let i = 0; i < cardIds.length && rows < TURN_ROWS_MAX; i += TURN_CARDS) {
    const chunk = cardIds.slice(i, i + TURN_CARDS);
    for (let from = 0; rows < TURN_ROWS_MAX; from += TURN_PAGE) {
      const page = await client.from("cloud_thread_items").select("card_id, at").eq("org_id", org).in("card_id", chunk).eq("kind", "result").order("card_id", { ascending: true }).order("seq", { ascending: true }).range(from, from + TURN_PAGE - 1);
      // A failed read keeps the chunks before it: those cards count by day, the rest as they did.
      if (page.error) {
        for (const id of chunk) out.delete(id);
        return out;
      }
      const got = page.data as { card_id: string; at: string }[];
      rows += got.length;
      for (const row of got) {
        const at = Date.parse(row.at);
        if (!Number.isFinite(at)) continue;
        const times = out.get(row.card_id);
        if (times) times.push(at);
        else out.set(row.card_id, [at]);
      }
      if (got.length < TURN_PAGE) break;
    }
  }
  return out;
}
