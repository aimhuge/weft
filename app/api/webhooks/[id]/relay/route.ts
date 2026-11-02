import { fail, guard } from "@/lib/guard";
import { createRelay, removeRelay } from "@/lib/webhook-forward";
import { isWorkerItem } from "@/lib/worker-item-id";

type Ctx = { params: Promise<{ id: string }> };

// A webhook's public relay URL on the deployed Weft (lib/webhook-forward.ts): POST makes it, DELETE takes it down.
// A Weft Worker's webhook gets one from a thread on that worker (mcp__webhooks__relay asks this Mac to seal it).
const WORKER_RELAY = "A worker's webhook gets its public URL from a thread on that worker (mcp__webhooks__relay), which asks this Mac for the Touch ID.";

const relayOf = async (params: Ctx["params"]) => {
  const { id } = await params;
  if (isWorkerItem(id)) throw new Error(WORKER_RELAY);
  return id;
};

export async function POST(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    return Response.json({ hook: await createRelay(await relayOf(params)) });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    return Response.json({ hook: await removeRelay(await relayOf(params)) });
  } catch (err) {
    return fail(err);
  }
}
