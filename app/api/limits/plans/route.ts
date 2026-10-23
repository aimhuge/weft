import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { readSamples } from "@/lib/limit-history";
import { planLimits } from "@/lib/plan-limits";

// Each CLI's newest 5-hour and weekly reading, for the status strip (lib/plan-limits.ts). Every CLI has
// its own plan, so the strip shows the open card's CLI's plan, or every CLI's when no card is open.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    return Response.json({ plans: planLimits(readSamples()) });
  } catch (err) {
    return fail(err, 500);
  }
}
