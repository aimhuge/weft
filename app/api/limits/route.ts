import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { readSamples } from "@/lib/limit-history";

// The plan-limit history behind the status strip's burndown chart (lib/limit-history.ts).
// ?backend=claude|puku|codex gives one CLI's readings: each CLI has its own plan (Claude Code on
// Anthropic's, puku-cli on Puku's), and the chart draws one of them. Without it, every CLI's.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const backend = new URL(req.url).searchParams.get("backend");
  try {
    const samples = readSamples();
    return Response.json({ samples: backend ? samples.filter((s) => s.backend === backend) : samples });
  } catch (err) {
    return fail(err, 500);
  }
}
