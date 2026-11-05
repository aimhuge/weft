import { checkInsOn, setCheckInsOn } from "@/lib/copilot-initiative-run";
import { fail, guard } from "@/lib/guard";

// Whether the copilot checks in on its own (lib/copilot-initiative.ts), and the copilot menu's switch for it.
export function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json({ on: checkInsOn() });
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const { on } = (await req.json()) as { on?: unknown };
    if (typeof on !== "boolean") return fail(new Error("on must be true or false"));
    setCheckInsOn(on);
    return Response.json({ on });
  } catch (err) {
    return fail(err);
  }
}
