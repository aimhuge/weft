import { guard } from "@/lib/guard";
import { hostFail, runVerb } from "@/lib/host-api";

// The task strip's Stop: ends one subagent or background command of the thread (card.stopTask).
export async function POST(req: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id, taskId } = await params;
  try {
    return Response.json(await runVerb("card.stopTask", { id, taskId }));
  } catch (err) {
    return hostFail(err);
  }
}
