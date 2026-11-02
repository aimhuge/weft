import { runCron } from "@/lib/cron-run";
import { fail, guard } from "@/lib/guard";
import { isWorkerItem, workerItemRefused } from "@/lib/worker-lists-read";

// The drawer's Run now: one run right away, outside the schedule.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    if (isWorkerItem(id)) throw new Error(workerItemRefused("cron"));
    return Response.json({ card: await runCron(id) });
  } catch (err) {
    return fail(err);
  }
}
