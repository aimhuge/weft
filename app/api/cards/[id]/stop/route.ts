import { guard } from "@/lib/guard";
import { hostFail, runVerb } from "@/lib/host-api";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    return Response.json(await runVerb("card.stop", { id }));
  } catch (err) {
    return hostFail(err);
  }
}
