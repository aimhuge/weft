import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { readSamples } from "@/lib/limit-history";
import { samePool } from "@/lib/plan-pools";
import type { Backend } from "@/lib/types";

// The plan-limit history behind the status strip's burndown chart (lib/limit-history.ts).
//
// ?backend=claude|puku|codex gives the PLAN's readings: Claude Code and puku-cli read one account's
// windows (lib/plan-pools.ts), so asking for either gives the same rows. Without it, every plan's.
//
// The chart asks without a backend and draws the account's whole history, so it can reach back across a
// weekly reset: a CLI with a short history of its own had nothing to look back at.
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
