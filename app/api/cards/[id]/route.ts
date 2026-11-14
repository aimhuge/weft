import { elevated, fail, guard } from "@/lib/guard";
import { trackActivation } from "@/lib/activation";
import { hostFail, needsElevation, requireCard, runVerb, type CardPatch } from "@/lib/host-api";

type Ctx = { params: Promise<{ id: string }> };

// One card's PATCH is the card.update verb (lib/host-api/card-update.ts): title, archive, marks, read scope,
// mode, agent, folder, column and place, validated there so every host refuses what the Mac refuses.
export async function PATCH(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    requireCard(id);
    const body = (await req.json()) as CardPatch;
    // A mode change or a read grant widens what the thread may do: only Weft's own window, not a thread's curl.
    const loose = needsElevation("card.update", { id, body }) ? elevated(req) : null;
    if (loose) return loose;
    if (body.column === "done") void trackActivation("done");
    return Response.json(await runVerb("card.update", { id, body }));
  } catch (err) {
    return hostFail(err);
  }
}

// One card's DELETE is the card.delete verb (lib/host-api/card-delete.ts): it ends the CLI, forgets a picked-up
// session, drops the card and an isolated card's worktree, and refuses the copilot. A worker runs the same verb.
export async function DELETE(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    return Response.json(await runVerb("card.delete", { id }));
  } catch (err) {
    return fail(err);
  }
}
