// A worker's plan-limit history, as its row holds it (lib/worker-limits.ts publishes it), for the burndown chart on a
// worker card (GET /api/limits?worker=), and with it the models at their own cap there, for that card's model pickers
// (GET /api/limits/plans?worker=). Read as you: RLS shows your workspace's workers, and a database without the column
// yet, or a worker too old to publish, reads as no history and no capped model.
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import type { LimitSample } from "./limit-chart";
import { unpackLimits, unpackModels } from "./limits-wire";
import type { ModelLimit } from "./model-limit";

async function readRow(workerId: string, client: SupabaseClient): Promise<unknown> {
  const { data, error } = await client.from("cloud_workers").select("limits").eq("id", workerId).maybeSingle<{ limits: unknown }>();
  return error || !data ? null : data.limits;
}

export async function workerLimitSamples(workerId: string, client: SupabaseClient = accountClient()): Promise<LimitSample[]> {
  return unpackLimits(await readRow(workerId, client));
}

/** The worker's history and the models at their cap there now, from one read of its row. */
export async function workerLimits(workerId: string, client: SupabaseClient = accountClient(), now = Date.now()): Promise<{ samples: LimitSample[]; models: ModelLimit[] }> {
  const row = await readRow(workerId, client);
  return { samples: unpackLimits(row), models: unpackModels(row, now) };
}
