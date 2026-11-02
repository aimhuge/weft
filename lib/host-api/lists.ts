// cron.* and webhook.*: the crons and webhooks a host keeps, changed from another machine (docs/architecture/crons.md#on-a-weft-worker).
// The Mac's ⏰ and 🪝 drawers send these to a Weft Worker as `host` commands, since a worker's crons fire on it and its
// webhooks reach its own dev server. args.id is the item's id on that host. The network's limits are remoteRefusal's
// (@weft/client list-policy.ts), checked before a verb runs; a cron run's mode is narrowed by the host that runs it
// (lib/worker-kinds.ts). None is elevated: on this Mac they're what the drawers' guard() routes already do.
import { runCron } from "../cron-run";
import type { Cron, CronPatch } from "../cron-types";
import { deleteCron, updateCron } from "../crons";
import type { Card, PermissionMode } from "../types";
import type { Webhook, WebhookPatch } from "../webhook-types";
import { removeWebhook, updateWebhook } from "../webhooks";
import { OK, settle, type Ok } from "./types";

export const NO_HOOK = "No such webhook.";

export const cronUpdateVerb = ({ id, patch }: { id: string; patch: CronPatch }): Promise<{ cron: Cron }> => settle(() => ({ cron: updateCron(id, patch) }));

export const cronDeleteVerb = ({ id }: { id: string }): Promise<Ok> =>
  settle(() => {
    deleteCron(id);
    return OK;
  });

// One run now. permissionMode, when given, is the mode the host allows a run from the network (never the row's own).
export async function cronRunVerb({ id, permissionMode }: { id: string; permissionMode?: PermissionMode }): Promise<{ card: Card }> {
  return { card: await runCron(id, Date.now(), permissionMode) };
}

export const webhookUpdateVerb = ({ id, patch }: { id: string; patch: WebhookPatch }): Promise<{ hook: Webhook }> => settle(() => ({ hook: updateWebhook(id, patch) }));

// Its relay row, if it has one, is the owner's: the Mac that asked takes it down (lib/worker-list-acts.ts).
export const webhookDeleteVerb = ({ id }: { id: string }): Promise<Ok> =>
  settle(() => {
    if (!removeWebhook(id)) throw new Error(NO_HOOK);
    return OK;
  });
