import { elevated, fail, guard } from "@/lib/guard";
import { hostFail, needsElevation, requireCard, runVerb, type CardPatch } from "@/lib/host-api";
import { endSession } from "@/lib/runner";
import { dismissSession } from "@/lib/settings";
import { deleteCard, getCard } from "@/lib/store";
import { dropWorktree } from "@/lib/worktree-pool";

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
    return Response.json(await runVerb("card.update", { id, body }));
  } catch (err) {
    return hostFail(err);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    if (getCard(id)?.role === "copilot") return fail("The copilot can't be deleted. Start a new chat instead.");
    const card = getCard(id);
    await endSession(id);
    // A picked-up session stays deleted; the sync won't bring it back.
    if (card?.source === "claude-code" && card.sessionId) dismissSession(card.sessionId);
    deleteCard(id);
    // An isolated card's worktree goes with it; a branch with commits that never landed stays (lib/worktree-pool.ts).
    if (card?.worktree) void dropWorktree(card.worktree).catch(() => {});
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
