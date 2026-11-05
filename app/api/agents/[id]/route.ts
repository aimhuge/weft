import { deleteAgent, updateAgent } from "@/lib/agent-store";
import { elevated, fail } from "@/lib/guard";

type Ctx = { params: Promise<{ id: string }> };

// Edit an agent, built-ins too (saved over the shipped one), or delete one you made.

export async function PATCH(req: Request, { params }: Ctx) {
  const denied = elevated(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    return Response.json({ agent: updateAgent(id, (await req.json()) as Record<string, unknown>) });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = elevated(req);
  if (denied) return denied;
  try {
    deleteAgent((await params).id);
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
