import { resetAgent } from "@/lib/agent-store";
import { elevated, fail } from "@/lib/guard";

type Ctx = { params: Promise<{ id: string }> };

// A built-in back to its latest text, pulled from Weft's repo on GitHub (the shipped one when GitHub can't be reached).
export async function POST(req: Request, { params }: Ctx) {
  const denied = elevated(req);
  if (denied) return denied;
  try {
    return Response.json(await resetAgent((await params).id));
  } catch (err) {
    return fail(err);
  }
}
