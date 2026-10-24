import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { switchBackend } from "@/lib/runner";
import { getCard } from "@/lib/store";
import { BACKEND_IDS, MODELS } from "@/lib/new-thread";
import type { Backend } from "@/lib/types";

// Every CLI a card may be switched to. Shared (lib/new-thread.ts), so a CLI added there can be
// switched to here too — a switch to a CLI this list didn't know was refused.
const BACKENDS: Backend[] = BACKEND_IDS;

// One-click "switch this card's CLI" — used by the right-click menu and the rate-limit banner.
// replay=true re-sends the last user message, which is what the rate-limit escape hatch wants.
// model (the thread header's picker) is one of that CLI's MODELS; on the card's own CLI it only
// changes the model. The list of models is the shared one (lib/new-thread.ts), so a CLI added
// there brings its models with it.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  await connection();
  try {
    const card = getCard(id);
    if (!card) return fail("No such card.", 404);
    const body = (await req.json()) as Record<string, unknown>;
    const backend = body.backend;
    if (typeof backend !== "string" || !BACKENDS.includes(backend as Backend)) {
      throw new Error(`backend must be one of ${BACKENDS.join(", ")}.`);
    }
    const model = body.model;
    if (model !== undefined && (typeof model !== "string" || !MODELS[backend as Backend].some((m) => m.id === model))) {
      throw new Error(`${typeof model === "string" ? model : "That"} isn't a ${backend} model.`);
    }
    await switchBackend(id, backend as Backend, { replay: body.replay === true, model });
    return Response.json({ card: getCard(id) });
  } catch (err) {
    return fail(err);
  }
}
