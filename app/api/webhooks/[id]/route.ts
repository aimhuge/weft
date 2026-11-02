import { elevated, fail, guard } from "@/lib/guard";
import { removeRelay } from "@/lib/webhook-forward";
import { actOnWorkerItem, deleteWorkerWebhook } from "@/lib/worker-list-acts";
import { isWorkerItem } from "@/lib/worker-lists-read";
import { getWebhook, removeWebhook, updateWebhook, type WebhookPatch } from "@/lib/webhooks";

type Ctx = { params: Promise<{ id: string }> };

// One webhook: PATCH changes its name, target, events, hint, secret or registered flag; DELETE takes its relay
// down first (when it has one), then the webhook. A Weft Worker's (worker:<id>:<hook>) changes on the worker, as a host
// verb from Weft's own window (lib/worker-list-acts.ts): its name, events, hint or registered flag, never its target,
// provider or secret (@weft/client list-policy.ts). It answers with no webhook: the drawer reads the republished list.
const gate = (req: Request, id: string) => (isWorkerItem(id) ? elevated(req) : guard(req));

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const denied = gate(req, id);
  if (denied) return denied;
  try {
    const patch = (await req.json()) as WebhookPatch;
    if (isWorkerItem(id)) return Response.json(await actOnWorkerItem(id, "webhook.update", { patch }));
    return Response.json({ hook: updateWebhook(id, patch) });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const denied = gate(req, id);
  if (denied) return denied;
  try {
    if (isWorkerItem(id)) return Response.json({ ok: true, ...(await deleteWorkerWebhook(id)) });
    if (getWebhook(id)?.relayId) await removeRelay(id);
    removeWebhook(id);
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
