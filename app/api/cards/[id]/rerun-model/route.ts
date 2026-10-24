import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { ALL_MODEL_IDS, backendFor } from "@/lib/new-thread";
import { rerunOnModel } from "@/lib/runner";
import { getCard } from "@/lib/store";

// One-click "rerun the last user message on a different model" — used by the first-message-failed
// banner in the open thread. The card's own model is what's exhausted (a rate limit or any other
// turn failure), so we start a fresh session of the same CLI on the user's chosen backup model and
// re-send the last user message. modelOn inside rerunOnModel normalizes the model to one the card's
// CLI actually serves, so a Puku card asking for claude-fable-5-1 lands on Puku's default.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  await connection();
  try {
    const card = getCard(id);
    if (!card) return fail("No such card.", 404);
    const body = (await req.json()) as Record<string, unknown>;
    const model = body.model;
    if (typeof model !== "string" || !model) {
      throw new Error("model must be a non-empty string.");
    }
    const backend = backendFor(model);
    // backendFor returns undefined for codex's default ("codex-default") because MODELS.codex
    // only lists that one model and the picker recognizes it as a token, not as a CLI lookup.
    // Any id in MODELS, regardless of CLI, is a valid backup.
    const inAnyCli = ALL_MODEL_IDS.has(model);
    if (!backend && !inAnyCli) {
      throw new Error(`${model} isn't a model any installed CLI serves.`);
    }
    await rerunOnModel(id, model);
    return Response.json({ card: getCard(id) });
  } catch (err) {
    return fail(err);
  }
}
