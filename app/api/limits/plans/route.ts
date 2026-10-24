import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { readSamples } from "@/lib/limit-history";
import { modelLimits } from "@/lib/model-limit";
import { planLimits } from "@/lib/plan-limits";

// The plan limits for the status strip (lib/plan-limits.ts): each CLI that has reported, carrying the
// account's newest 5-hour and weekly reading. The plan limits are ONE pool per account, shared by every
// CLI, so the numbers are the account's; the key is the CLI that reported, so the strip shows the open
// card's CLI's plan, or every CLI's when no card is open.
//
// The models that have hit their own cap come with it (lib/model-limit.ts): the limits are per model as
// well as per CLI, so a model can be spent while the CLI's 5-hour window still has room. The New thread
// dialog reads both to know whether a thread can start now (lib/limit-reset.ts).
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    return Response.json({ plans: planLimits(readSamples()), models: modelLimits() });
  } catch (err) {
    return fail(err, 500);
  }
}
