import { guard } from "@/lib/guard";
import { hostFail, messageCall, runVerb, type MessageBody } from "@/lib/host-api";

// A reply to the card: card.message, card.message.edit (↑ in the reply box) or card.restart (a stopped card's
// Restart button), picked from the body by messageCall (lib/host-api).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const { verb, args } = messageCall(id, (await req.json()) as MessageBody);
    return Response.json(await runVerb(verb, args));
  } catch (err) {
    return hostFail(err);
  }
}
