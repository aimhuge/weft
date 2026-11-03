import { elevated } from "@/lib/guard";
import { shell } from "@/lib/browser-shell";
import { deviceId } from "@/lib/device-id";
import { hostFail, permissionCall, runVerb, type PermissionBody } from "@/lib/host-api";
import { localApprovalProblem, type LocalAnswer } from "@/lib/local-approve";
import { getCard } from "@/lib/store";

// The answer to a card's permission prompt or question: card.permission.answer, .wait, .first or .otherFirst,
// picked from the body by permissionCall (lib/host-api/card-permission.ts). An answer passes this Mac's own rule
// first (lib/local-approve.ts): an Allow on a phone-only ask needs main's signature after Touch ID.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = elevated(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const body = (await req.json()) as PermissionBody & LocalAnswer;
    const { verb, args } = permissionCall(id, body);
    const card = verb === "card.permission.answer" ? getCard(id) : undefined;
    const problem =
      card &&
      (await localApprovalProblem(card, body, {
        verify: async (b) => (await shell("/pairing/verify", b)) as { ok: boolean; reason?: string },
        self: deviceId(),
        now: Date.now(),
      }));
    if (problem) return Response.json({ error: problem }, { status: 403 });
    return Response.json(await runVerb(verb, args));
  } catch (err) {
    return hostFail(err, 409);
  }
}
