import { guard } from "@/lib/guard";
import { hostFail, runVerb } from "@/lib/host-api";

// "Send fresh" on a card with a cold prompt cache: a new session in the same card, started from a brief of the
// thread, with the message typed in the reply box (lib/splice.ts). The card.fresh verb (lib/host-api).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const { message } = (await req.json()) as { message?: string };
    return Response.json(await runVerb("card.fresh", { id, message }));
  } catch (err) {
    return hostFail(err);
  }
}
