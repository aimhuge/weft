// The Mac's side of a Weft Worker's published crons and webhooks (lib/worker-lists.ts): read with the account's own
// session (cloud_worker_lists is owner-only), each put on its worker project's path and given an id the Mac can't
// mistake for its own, so GET /api/crons and /api/webhooks list them beside this Mac's. The Mac's PATCH, DELETE and Run
// now send a change to one as a host verb to its worker (lib/worker-list-acts.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import type { Cron } from "./cron-types";
import type { Webhook } from "./webhook-types";
import { workerItemId } from "./worker-item-id";
import { workerProjectPath } from "./worker-project";

export interface WorkerLists {
  crons: Cron[];
  webhooks: Webhook[];
}

interface ListRow {
  worker_id: string;
  crons: Cron[] | null;
  webhooks: Webhook[] | null;
}

const EMPTY: WorkerLists = { crons: [], webhooks: [] };
export const CACHE_MS = 15_000;

export { isWorkerItem, parseWorkerItem, WORKER_ITEM } from "./worker-item-id";

export function placeLists(rows: ListRow[], names: Map<string, string>): WorkerLists {
  const out: WorkerLists = { crons: [], webhooks: [] };
  for (const row of rows) {
    const worker = names.get(row.worker_id) ?? "worker";
    for (const c of row.crons ?? []) out.crons.push({ ...c, id: workerItemId(row.worker_id, c.id), cwd: workerProjectPath(row.worker_id, c.cwd), worker });
    for (const h of row.webhooks ?? []) out.webhooks.push({ ...h, id: workerItemId(row.worker_id, h.id), folder: workerProjectPath(row.worker_id, h.folder), worker });
  }
  return out;
}

// Never throws: signed out, offline or a database without the table yet all read as no worker lists.
export async function readWorkerLists(client: SupabaseClient = accountClient()): Promise<WorkerLists> {
  try {
    const { data: auth } = await client.auth.getSession();
    if (!auth.session) return EMPTY;
    const [lists, workers] = await Promise.all([
      client.from("cloud_worker_lists").select("worker_id, crons, webhooks"),
      client.from("cloud_workers").select("id, name"),
    ]);
    if (lists.error) return EMPTY;
    const names = new Map<string, string>((workers.data ?? []).map((w: { id: string; name: string }) => [w.id, w.name]));
    return placeLists(lists.data, names);
  } catch {
    return EMPTY;
  }
}

let cached: { at: number; lists: Promise<WorkerLists> } | null = null;

// The drawers poll; the cloud is read at most every CACHE_MS.
export function workerLists(now = Date.now(), read: () => Promise<WorkerLists> = readWorkerLists): Promise<WorkerLists> {
  if (!cached || now - cached.at > CACHE_MS) cached = { at: now, lists: read() };
  return cached.lists;
}

export function forgetWorkerLists() {
  cached = null;
}

// After a change sent to a worker: forget now, and again once it has republished, so a read in between can't keep
// the old list for CACHE_MS.
export function forgetWorkerListsSoon(settleMs: number) {
  cached = null;
  setTimeout(forgetWorkerLists, settleMs).unref();
}
