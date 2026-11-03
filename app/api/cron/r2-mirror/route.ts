import { connection } from "next/server";
import { sweepAllResults } from "@/lib/host-result-sweep";
import { r2Config } from "@/lib/r2";
import { mirrorPending } from "@/lib/r2-mirror";
import { serviceClient } from "@/lib/web-session";

// The R2 mirror's sweep (lib/r2-mirror.ts, docs/architecture/r2.md), on the deployed Weft: Vercel's cron
// (vercel.json) calls it daily with `Authorization: Bearer $CRON_SECRET`, and copies every weft-blobs object
// that isn't in R2 yet. Most blobs move sooner, when a read falls back to Supabase and queues its own copy; this
// catches the ones nobody has opened. A Weft without the service key or R2's settings says so and copies nothing.
//
// It's the bucket's daily upkeep, so it also sweeps host results over a day old in every workspace with a worker
// (lib/host-result-sweep.ts): a worker sweeps its own hourly, and this catches the workspace whose worker is gone.
// That runs with the service key alone, before the R2 check, and a failure there never stops the mirror.

export const maxDuration = 300;

export async function GET(req: Request) {
  await connection();
  const cron = process.env.CRON_SECRET;
  if (!cron || req.headers.get("authorization") !== `Bearer ${cron}`) return new Response("Unauthorized", { status: 401 });
  const service = serviceClient();
  if (!service) return new Response("R2 isn't set up on this Weft.", { status: 503 });
  const results = await sweepAllResults(service).catch((err: unknown) => ({ orgs: 0, removed: 0, failed: [(err as Error).message] }));
  if (results.failed.length) console.error(`Host results sweep: ${results.failed.slice(0, 10).join("; ")}`);
  const r2 = r2Config();
  if (!r2) return new Response("R2 isn't set up on this Weft.", { status: 503 });
  try {
    const result = await mirrorPending(service, r2);
    if (result.failed.length) console.error(`R2 mirror: ${result.failed.slice(0, 10).join("; ")}`);
    return Response.json({ ...result, failed: result.failed.length, results: results.removed });
  } catch (err) {
    console.error(`R2 mirror: ${(err as Error).message}`);
    return new Response("Couldn't run the R2 mirror", { status: 502 });
  }
}
