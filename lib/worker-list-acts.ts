// The Mac's ⏰ and 🪝 drawers changing a Weft Worker's cron or webhook (docs/architecture/crons.md#on-a-weft-worker).
// They live on the worker, so the change goes to it as a host verb (cron.update, cron.delete, cron.run, webhook.update,
// webhook.delete; lib/host-api/lists.ts) on a `host` row addressed to that worker, and this waits a few seconds for its
// answer: a refusal comes back as the error, one the worker hasn't taken yet as `queued` (it runs when the worker is
// back). Only the owner's own headless workers are reached, and the worker checks the row against remoteRefusal
// (@weft/client list-policy.ts) before it runs.
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import type { NewCommand } from "./cloud-commands";
import type { ListVerb } from "@weft/client";
import { hostCommand } from "./host-command";
import { insert, myWorkers, requireSession } from "./worker-board";
import { waitForCommand, type WaitOptions } from "./worker-command-wait";
import { workerDevice } from "./worker-commands";
import { parseWorkerItem, WORKER_LIST_SETTLE_MS } from "./worker-item-id";
import { forgetWorkerListsSoon, workerLists } from "./worker-lists-read";
import { commandResult } from "./workers-account";

// A drawer's click waits this long for the worker before it says queued.
export const LIST_ACT_WAIT: WaitOptions = { every: (ask) => Math.min(500 * 2 ** ask, 2_000), unclaimed: 8_000, claimed: 30_000 };

export interface ListActResult {
  // The worker hasn't taken it yet: it's offline or busy, and runs it when it's back.
  queued?: true;
  // cron.run: the run's card on the worker.
  cardId?: string;
}

export const NOT_WORKER_ITEM = "That isn't a cron or webhook of one of your Weft Workers.";

export async function actOnWorkerItem(
  itemId: string,
  verb: ListVerb,
  args: Record<string, unknown> = {},
  client: SupabaseClient = accountClient(),
  wait: WaitOptions = LIST_ACT_WAIT,
): Promise<ListActResult> {
  const item = parseWorkerItem(itemId);
  if (!item) throw new Error(NOT_WORKER_ITEM);
  const who = await requireSession(client);
  if (!(await myWorkers(client, who)).some((w) => w.id === item.workerId)) throw new Error("That worker isn't one of yours.");
  const row = hostCommand({ orgId: who.org, device: workerDevice(item.workerId), folder: "-", cardId: item.id }, verb, args) as unknown as NewCommand;
  const { commandId } = await insert(client, row);
  const done = await waitForCommand(() => commandResult(commandId, client), wait);
  forgetWorkerListsSoon(WORKER_LIST_SETTLE_MS);
  if (done.status === "failed") throw new Error(done.error || "Your worker couldn't do that.");
  if (done.status !== "done") return { queued: true };
  const made = (done.result as { cardId?: unknown } | null | undefined)?.cardId;
  return typeof made === "string" && made ? { cardId: made } : {};
}

// A worker's webhook gone: the worker drops it, then its relay row (the owner's, made by this Mac for the worker)
// goes too, so the public URL stops taking deliveries for a route nobody keeps. A queued delete leaves the relay
// until it has run. The relay id is the worker's word (its published list), so the delete is held to that worker's own
// relay rows: a worker naming another relay of the owner's (the Mac's own, another worker's) takes nothing down.
export async function deleteWorkerWebhook(itemId: string, client: SupabaseClient = accountClient(), wait: WaitOptions = LIST_ACT_WAIT): Promise<ListActResult> {
  const item = parseWorkerItem(itemId);
  if (!item) throw new Error(NOT_WORKER_ITEM);
  const relayId = (await workerLists()).webhooks.find((h) => h.id === itemId)?.relayId;
  const done = await actOnWorkerItem(itemId, "webhook.delete", {}, client, wait);
  if (!done.queued && relayId) {
    const { error } = await client.from("webhook_relays").delete().eq("id", relayId).eq("worker_id", item.workerId);
    if (error) throw new Error(`The webhook is gone from your worker, but its public URL couldn't be taken down: ${error.message}`);
  }
  return done;
}
