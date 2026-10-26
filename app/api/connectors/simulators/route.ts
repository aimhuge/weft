import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { simulatorStatus } from "@/lib/simulator-status";

// Settings → Connectors → Simulators: what the simulator tools have on this Mac, and the fix for what's missing.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    return Response.json(await simulatorStatus());
  } catch (err) {
    return fail(err);
  }
}
