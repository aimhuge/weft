import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { readSamples } from "@/lib/limit-history";
import { samePool } from "@/lib/plan-pools";
import type { Backend } from "@/lib/types";
import { workerLimitSamples } from "@/lib/worker-limits-read";

// The plan-limit history behind the status strip's burndown chart (lib/limit-history.ts).
//
// ?backend=claude|puku|codex gives that CLI's OWN readings: each CLI has its own plan
// (lib/plan-pools.ts), so asking for puku gives Puku's rows and never Claude's. Without it, every CLI's.
//
// ?worker=<id> gives that Weft Worker's history instead of this Mac's: what it published to its row
// (lib/worker-limits.ts), for a worker card's chart.
//
// The chart asks for the CLI it is drawing, so the plot is that plan's own history and can reach back
// across a weekly reset.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const params = new URL(req.url).searchParams;
  const backend = params.get("backend") as Backend | null;
  const worker = params.get("worker");
  try {
    const samples = worker ? await workerLimitSamples(worker) : readSamples();
    return Response.json({ samples: backend ? samples.filter((s) => samePool(s.backend, backend)) : samples });
  } catch (err) {
    return fail(err, 500);
  }
}
