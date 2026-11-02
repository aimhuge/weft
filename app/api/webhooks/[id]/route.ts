import { fail, guard } from "@/lib/guard";
import { removeRelay } from "@/lib/webhook-forward";
import { isWorkerItem, workerItemRefused } from "@/lib/worker-lists-read";
import { getWebhook, removeWebhook, updateWebhook, type WebhookPatch } from "@/lib/webhooks";

type Ctx = { params: Promise<{ id: string }> };

// One webhook: PATCH changes its name, target, events, hint, secret or registered flag; DELETE takes its relay
// down first (when it has one), then the webhook.

export async function PATCH(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    if (isWorkerItem(id)) throw new Error(workerItemRefused("webhook"));
    return Response.json({ hook: updateWebhook(id, (await req.json()) as WebhookPatch) });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    if (isWorkerItem(id)) throw new Error(workerItemRefused("webhook"));
    if (getWebhook(id)?.relayId) await removeRelay(id);
    removeWebhook(id);
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
