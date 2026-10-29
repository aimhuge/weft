import { connection } from "next/server";
import { r2Config } from "@/lib/r2";
import { mirrorPending } from "@/lib/r2-mirror";
import { serviceClient } from "@/lib/web-session";

// The R2 mirror's sweep (lib/r2-mirror.ts, docs/architecture/r2.md), on the deployed Weft: Vercel's cron
// (vercel.json) calls it daily with `Authorization: Bearer $CRON_SECRET`, and copies every weft-blobs object
// that isn't in R2 yet. Most blobs move sooner, when a read falls back to Supabase and queues its own copy; this
// catches the ones nobody has opened. A Weft without the service key or R2's settings says so and copies nothing.

export const maxDuration = 300;

export async function GET(req: Request) {
  await connection();
  const cron = process.env.CRON_SECRET;
  if (!cron || req.headers.get("authorization") !== `Bearer ${cron}`) return new Response("Unauthorized", { status: 401 });
  const service = serviceClient();
  const r2 = r2Config();
  if (!service || !r2) return new Response("R2 isn't set up on this Weft.", { status: 503 });
  try {
    const result = await mirrorPending(service, r2);
    if (result.failed.length) console.error(`R2 mirror: ${result.failed.slice(0, 10).join("; ")}`);
    return Response.json({ ...result, failed: result.failed.length });
  } catch (err) {
    console.error(`R2 mirror: ${(err as Error).message}`);
    return new Response("Couldn't run the R2 mirror", { status: 502 });
  }
}
