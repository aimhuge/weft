import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { readSamples } from "@/lib/limit-history";

// The plan-limit history behind the status strip's burndown chart (lib/limit-history.ts).
//
// The plan limits are ONE pool per account, shared by every CLI: Claude Code and puku-cli report the
// same 5-hour and weekly windows, with the same reset times, because they draw from the same plan. So
// the answer is the account's whole history — which is what the chart draws, so it can reach back into
// last week (lib/limit-chart.ts's lookback).
//
// There is no per-CLI narrowing on purpose. A card on the CLI with the fewest readings would then get
// a history too short to look back with, and the chart would quietly stop reaching back into the week
// before a reset — the bug docs/bug-fixes/031-limits-chart-never-reached-back-into-last-week.md is
// about. The one place that wants a single CLI's own readings reads the log itself
// (lib/plan-limits.ts, on the server).
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    return Response.json({ samples: readSamples() });
  } catch (err) {
    return fail(err, 500);
  }
}
