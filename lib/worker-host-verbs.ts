// A verb on one of your Weft Workers itself rather than a card (settings.get / settings.put,
// docs/architecture/project-hosts.md#settings-on-a-worker-wp3): a `host` row addressed to the worker, with no folder and
// no card. Only a worker you enrolled, and only a host-level verb; the worker refuses any setting outside HOST_SETTINGS.
import type { SupabaseClient } from "@supabase/supabase-js";
import { hostLevelRow, isHostLevelVerb, isHostVerb } from "@weft/client";
import { accountClient } from "./account";
import { myWorkers, requireSession } from "./worker-board";
import { workerDevice } from "./worker-commands";

export type WorkerHostAction = { workerId: string; verb: string; args?: Record<string, unknown> };

export async function sendWorkerHostVerb(body: WorkerHostAction, client: SupabaseClient = accountClient()): Promise<{ commandId: string }> {
  if (!isHostVerb(body.verb) || !isHostLevelVerb(body.verb)) throw new Error(`A worker doesn't take ${body.verb.slice(0, 40)} for itself.`);
  const who = await requireSession(client);
  if (!(await myWorkers(client, who)).some((w) => w.id === body.workerId)) throw new Error("That worker isn't one of yours.");
  const row = hostLevelRow({ orgId: who.org, device: workerDevice(body.workerId) }, body.verb, body.args ?? {});
  const { data, error } = await client.from("cloud_commands").insert(row).select("id").single<{ id: string }>();
  if (error) throw new Error(`Couldn't reach your worker: ${error.message}`);
  return { commandId: data.id };
}
