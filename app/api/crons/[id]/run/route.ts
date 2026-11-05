import { runCron } from "@/lib/cron-run";
import { elevated, fail, guard } from "@/lib/guard";
import { actOnWorkerItem } from "@/lib/worker-list-acts";
import { isWorkerItem } from "@/lib/worker-lists-read";

// The drawer's Run now: one run right away, outside the schedule. A worker's cron runs on the worker, in the mode it
// allows a run from the network (lib/worker-kinds.ts listVerb); its card shows on the board once the worker publishes it.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const denied = isWorkerItem(id) ? elevated(req) : guard(req);
  if (denied) return denied;
  try {
    if (isWorkerItem(id)) return Response.json(await actOnWorkerItem(id, "cron.run"));
    return Response.json({ card: await runCron(id) });
  } catch (err) {
    return fail(err);
  }
}
