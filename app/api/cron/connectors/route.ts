import { connection } from "next/server";
import { connectorDeps } from "@/lib/connector-deps";
import { sweep } from "@/lib/connector-sweep";

// The connector minter's daily sweep (lib/connector-sweep.ts, docs/architecture/connectors.md), on the deployed Weft:
// Vercel's cron (vercel.json) calls it with `Authorization: Bearer $CRON_SECRET`. It ends what grants past their
// lifetime left behind and retries the token deletes and disconnects GitHub didn't confirm.

export const maxDuration = 300;

export async function GET(req: Request) {
  await connection();
  const cron = process.env.CRON_SECRET;
  if (!cron || req.headers.get("authorization") !== `Bearer ${cron}`) return new Response("Unauthorized", { status: 401 });
  const deps = connectorDeps();
  if (!deps) return new Response("GitHub connectors aren't set up on this Weft.", { status: 503 });
  try {
    const result = await sweep(deps);
    if (result.failed.length) console.error(`Connector sweep: ${result.failed.slice(0, 10).join("; ")}`);
    return Response.json({ ...result, failed: result.failed.length });
  } catch (err) {
    console.error(`Connector sweep: ${(err as Error).message}`);
    return new Response("Couldn't run the connector sweep", { status: 502 });
  }
}
