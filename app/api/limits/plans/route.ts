import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { readSamples } from "@/lib/limit-history";
import { modelLimits } from "@/lib/model-limit";
import { planLimits } from "@/lib/plan-limits";
import { workerLimits } from "@/lib/worker-limits-read";

// The plan limits, for the status strip (lib/plan-limits.ts): each CLI that has reported, carrying its
// OWN newest 5-hour and weekly reading. Each CLI has its own plan (lib/plan-pools.ts), so the strip shows
// the open card's CLI's plan, or every CLI's when no card is open.
//
// The models that have hit their own cap come with it (lib/model-limit.ts): the limits are per model as
// well as per plan, so a model can be spent while the plan's 5-hour window still has room. The New thread
// dialog reads both to know whether a thread can start now (lib/limit-reset.ts).
//
// ?worker=<id> gives that Weft Worker's instead, as it published them to its row (lib/worker-limits.ts): a worker card
// runs on the worker's sign-in, so its model pickers mark the worker's capped models (lib/use-plan-limits.ts).
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const worker = new URL(req.url).searchParams.get("worker");
  try {
    const { samples, models } = worker ? await workerLimits(worker) : { samples: readSamples(), models: modelLimits() };
    return Response.json({ plans: planLimits(samples), models });
  } catch (err) {
    return fail(err, 500);
  }
}
