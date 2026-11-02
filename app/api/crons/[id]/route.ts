import type { CronPatch } from "@/lib/cron-types";
import { deleteCron, updateCron } from "@/lib/crons";
import { elevated, fail, guard } from "@/lib/guard";
import { actOnWorkerItem } from "@/lib/worker-list-acts";
import { isWorkerItem } from "@/lib/worker-lists-read";

type Ctx = { params: Promise<{ id: string }> };

// A Weft Worker's cron (worker:<id>:<cron>) lives on it: the change goes there as a host verb (lib/worker-list-acts.ts),
// which takes Weft's own window, as every act on a worker does (app/api/worker-board), and answers `queued` when the
// worker hasn't taken it yet. It comes back with no cron: the drawer reads the worker's republished list.
const gate = (req: Request, id: string) => (isWorkerItem(id) ? elevated(req) : guard(req));

// Turn a cron on or off, or change its prompt, schedule, name or mode.
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const denied = gate(req, id);
  if (denied) return denied;
  try {
    const patch = (await req.json()) as CronPatch;
    if (isWorkerItem(id)) return Response.json(await actOnWorkerItem(id, "cron.update", { patch }));
    return Response.json({ cron: updateCron(id, patch) });
  } catch (err) {
    return fail(err);
  }
}

// Its run cards stay on the board.
export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const denied = gate(req, id);
  if (denied) return denied;
  try {
    if (isWorkerItem(id)) return Response.json({ ok: true, ...(await actOnWorkerItem(id, "cron.delete")) });
    deleteCron(id);
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
