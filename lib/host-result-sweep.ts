// Host results' blobs expire (lib/host-result.ts): a host verb's answer too big for its command's row goes up to
// weft-blobs under <org>/results/<sha> (app/api/worker-blob), the board reads it once, and nothing else ever names it.
// So it lives a day. Two sweeps remove what's older: each Weft Worker asks hourly for its own workspace (POST
// /api/worker-blob `sweep: true`), and the R2 mirror's daily cron (app/api/cron/r2-mirror) sweeps every workspace
// with a headless worker, for the one whose worker is gone. The R2 mirror never copies results/, so the bucket is
// the only place they are.
import type { SupabaseClient } from "@supabase/supabase-js";
import { BLOB_BUCKET } from "./cloud-sync-types";

// The folder a worker's verb results go in, and how long one lives: long enough for the board that asked to read it.
export const RESULTS = "results";
export const RESULT_TTL_MS = 24 * 60 * 60_000;
// One call lists and removes at most this many; the next sweep takes the rest.
const PAGE = 1000;

type Service = Pick<SupabaseClient, "from" | "storage">;

// Removes one workspace's results over a day old, oldest first. Answers how many; throws when the bucket fails.
export async function sweepResults(service: Pick<SupabaseClient, "storage">, orgId: string, now = Date.now()): Promise<number> {
  const folder = `${orgId}/${RESULTS}`;
  const bucket = service.storage.from(BLOB_BUCKET);
  const { data, error } = await bucket.list(folder, { limit: PAGE, sortBy: { column: "created_at", order: "asc" } });
  if (error) throw new Error(error.message);
  const dead = data.filter((o) => o.created_at && now - Date.parse(o.created_at) > RESULT_TTL_MS).map((o) => `${folder}/${o.name}`);
  if (!dead.length) return 0;
  const { error: removeError } = await bucket.remove(dead);
  if (removeError) throw new Error(removeError.message);
  return dead.length;
}

// Every workspace that has a headless worker, each swept on its own: one that fails is named and the rest carry on.
export async function sweepAllResults(service: Service, now = Date.now()): Promise<{ orgs: number; removed: number; failed: string[] }> {
  const { data, error } = await service.from("cloud_workers").select("org_id").eq("kind", "headless").overrideTypes<{ org_id: string }[]>();
  if (error) throw new Error(error.message);
  const orgs = [...new Set(data.map((r) => r.org_id))];
  let removed = 0;
  const failed: string[] = [];
  for (const org of orgs) {
    try {
      removed += await sweepResults(service, org, now);
    } catch (err) {
      failed.push(`${org}: ${(err as Error).message}`);
    }
  }
  return { orgs: orgs.length, removed, failed };
}
