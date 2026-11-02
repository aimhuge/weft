import { guard } from "@/lib/guard";
import { hostFail, runVerb } from "@/lib/host-api";

// Queue a message to send at a set time: { text, at } with at in unix ms. The card.schedule verb (lib/host-api).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const { text, at } = (await req.json()) as { text?: string; at?: number };
    return Response.json(await runVerb("card.schedule", { id, text, at }));
  } catch (err) {
    return hostFail(err);
  }
}

// Take a scheduled message back: { messageId }. The card.unschedule verb.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const { messageId } = (await req.json()) as { messageId?: string };
    return Response.json(await runVerb("card.unschedule", { id, messageId }));
  } catch (err) {
    return hostFail(err);
  }
}
