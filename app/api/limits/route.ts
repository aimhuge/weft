import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { readSamples } from "@/lib/limit-history";
import { samePool } from "@/lib/plan-pools";
import type { Backend } from "@/lib/types";

// The plan-limit history behind the status strip's burndown chart (lib/limit-history.ts).
//
// ?backend=claude|puku|codex gives that CLI's OWN readings: each CLI has its own plan
// (lib/plan-pools.ts), so asking for puku gives Puku's rows and never Claude's. Without it, every CLI's.
//
// The chart asks for the CLI it is drawing, so the plot is that plan's own history and can reach back
// across a weekly reset.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const backend = new URL(req.url).searchParams.get("backend") as Backend | null;
  try {
    const samples = readSamples();
    return Response.json({ samples: backend ? samples.filter((s) => samePool(s.backend, backend)) : samples });
  } catch (err) {
    return fail(err, 500);
  }
}
