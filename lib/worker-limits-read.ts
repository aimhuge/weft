// A worker's plan-limit history, as its row holds it (lib/worker-limits.ts publishes it), for the burndown chart on a
// worker card (GET /api/limits?worker=). Read as you: RLS shows your workspace's workers, and a database without the
// column yet, or a worker too old to publish, reads as no history.
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import type { LimitSample } from "./limit-chart";
import { unpackLimits } from "./limits-wire";

export async function workerLimitSamples(workerId: string, client: SupabaseClient = accountClient()): Promise<LimitSample[]> {
  const { data, error } = await client.from("cloud_workers").select("limits").eq("id", workerId).maybeSingle<{ limits: unknown }>();
  if (error || !data) return [];
  return unpackLimits(data.limits);
}
