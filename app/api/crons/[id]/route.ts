import type { CronPatch } from "@/lib/cron-types";
import { deleteCron, updateCron } from "@/lib/crons";
import { fail, guard } from "@/lib/guard";

type Ctx = { params: Promise<{ id: string }> };

// Turn a cron on or off, or change its prompt, schedule, name or mode.
export async function PATCH(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const patch = (await req.json()) as CronPatch;
    return Response.json({ cron: updateCron(id, patch) });
  } catch (err) {
    return fail(err);
  }
}

// Its run cards stay on the board.
export async function DELETE(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    deleteCron(id);
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
