import { connection } from "next/server";
import { guard } from "@/lib/guard";
import { hostFail, requireCard, runVerb } from "@/lib/host-api";

// One-click "switch this card's CLI" (the right-click menu, the rate-limit banner, the thread header's
// model picker): the card.switchBackend verb (lib/host-api/card-cli.ts).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  await connection();
  try {
    // A missing card is a 404 before the body is read.
    requireCard(id);
    const body = (await req.json()) as Record<string, unknown>;
    return Response.json(await runVerb("card.switchBackend", { id, backend: body.backend, model: body.model, replay: body.replay }));
  } catch (err) {
    return hostFail(err);
  }
}
