import { elevated } from "@/lib/guard";
import { hostFail, permissionCall, runVerb, type PermissionBody } from "@/lib/host-api";

// The answer to a card's permission prompt or question: card.permission.answer, .wait, .first or .otherFirst,
// picked from the body by permissionCall (lib/host-api/card-permission.ts).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = elevated(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const { verb, args } = permissionCall(id, (await req.json()) as PermissionBody);
    return Response.json(await runVerb(verb, args));
  } catch (err) {
    return hostFail(err, 409);
  }
}
