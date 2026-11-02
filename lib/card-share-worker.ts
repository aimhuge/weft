// Share… on a Weft Worker's card (docs/architecture/sharing.md#a-worker-card): the card isn't in this Mac's store, but its
// rows are already in cloud_cards and cloud_thread_items, which the worker publishes under its owner's account
// (worker_put_card sets owner_user to the worker's owner). A share only needs that row, so this finds it with no
// command to the worker. The owner check is the row's owner_user: only the signed-in account's own workers' cards are
// found, and cloud_shares' RLS (private.is_card_owner) asks the same of every write. Deleted rows don't share.
import type { SupabaseClient } from "@supabase/supabase-js";

// The workspace the worker publishes to, and the title its slug starts from.
export interface WorkerShareCard {
  orgId: string;
  title: string;
}

type Row = { org_id: string; card: { title?: unknown } | null };

export async function workerShareCard(client: SupabaseClient, userId: string, cardId: string): Promise<WorkerShareCard | null> {
  const { data, error } = await client
    .from("cloud_cards")
    .select("org_id, card")
    .eq("card_id", cardId)
    .eq("owner_user", userId)
    .eq("deleted", false)
    .not("owner_worker", "is", null)
    .limit(1)
    .maybeSingle<Row>();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const title = data.card?.title;
  return { orgId: data.org_id, title: typeof title === "string" ? title : "" };
}
