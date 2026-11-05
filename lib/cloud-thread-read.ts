// One synced card's thread, read from its workspace's cloud rows as the signed-in account (RLS decides): a page of
// cloud_thread_items and a cut tool output from cloud_tool_outputs, sealed rows opened with this Mac's keys
// (lib/worker-board-open.ts). Your worker's cards read them in your workspace (lib/worker-board.ts), a teammate's in
// the team's (lib/team-board.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import { THREAD_PAGE_SIZE } from "./cloud-sync-types";
import { pageFromRows } from "./cloud-thread-page";
import type { ThreadPage } from "./thread-page";
import { openItemRows, openOutput } from "./worker-board-open";

// One page, newest first. With `after`, only the items with a seq past it (a poll's delta, lib/worker-poll.ts); when
// none is, an empty page that still carries the thread's total, so a rewound thread shows. Null when it can't be read.
export async function threadPageIn(client: SupabaseClient, org: string, cardId: string, before?: number, after?: number): Promise<ThreadPage | null> {
  let query = client.from("cloud_thread_items").select("card_id, seq, item, at").eq("org_id", org).eq("card_id", cardId);
  if (before !== undefined) query = query.lt("seq", before);
  if (after !== undefined) query = query.gt("seq", after);
  const { data, error } = await query.order("seq", { ascending: false }).limit(THREAD_PAGE_SIZE);
  if (error) return null;
  if (after === undefined || data.length) return pageFromRows(cardId, await openItemRows(org, data));
  const head = await client.from("cloud_thread_items").select("seq").eq("org_id", org).eq("card_id", cardId).order("seq", { ascending: false }).limit(1);
  if (head.error) return null;
  return { items: [], start: after + 1, total: head.data.length ? (head.data[0] as { seq: number }).seq + 1 : 0 };
}

// The full result of a tool call whose result was cut out of its item.
export async function toolOutputIn(client: SupabaseClient, org: string, cardId: string, toolId: string): Promise<string> {
  const { data, error } = await client.from("cloud_tool_outputs").select("result").eq("org_id", org).eq("card_id", cardId).eq("tool_id", toolId).maybeSingle<{ result: string }>();
  if (error || !data) throw new Error("That output isn't there.");
  return openOutput(org, cardId, toolId, data.result);
}
