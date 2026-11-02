import { elevated, guard } from "@/lib/guard";
import { hostFail, messageCall, runVerb, type MessageBody } from "@/lib/host-api";
import { noteClient } from "@/lib/turn-client";
import { deskClient } from "@/lib/turn-env";

// A reply to the card: card.message, card.message.edit (↑ in the reply box) or card.restart (a stopped card's
// Restart button), picked from the body by messageCall (lib/host-api).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const { verb, args } = messageCall(id, (await req.json()) as MessageBody);
    // Who sent it, for the turn's <weft-env> block: a hint, never a check (docs/architecture/thread-env.md).
    noteClient(id, deskClient(elevated(req) === null));
    return Response.json(await runVerb(verb, args));
  } catch (err) {
    return hostFail(err);
  }
}
