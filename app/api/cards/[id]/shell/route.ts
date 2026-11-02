import { elevated } from "@/lib/guard";
import { hostFail, runVerb } from "@/lib/host-api";

// "!" in the reply box: starts your command in the card's folder. It answers once the command has started;
// the thread shows its output when it ends. The card.shell verb (lib/host-api).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = elevated(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const { command } = (await req.json()) as { command?: string };
    return Response.json(await runVerb("card.shell", { id, command }));
  } catch (err) {
    return hostFail(err);
  }
}
