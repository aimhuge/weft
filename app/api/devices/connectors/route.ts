import { connection } from "next/server";
import { accountClient } from "@/lib/account";
import { connectorsView } from "@/lib/connector-view";
import { remoteDisconnect, remoteRevoke, revokeNote } from "@/lib/connector-remote";
import { elevated, fail, guard } from "@/lib/guard";

// Settings → Devices → a worker → Connectors (components/WorkerConnectors.tsx, docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built):
// GET reads your grants, last use, waiting Allows and whether GitHub is connected; DELETE ?worker= turns GitHub off for a
// worker through weft.zip, which also ends its tokens at GitHub; DELETE ?all=1 disconnects GitHub altogether. Turning
// it on and loosening it go through main instead (window.weft.connectors, Touch ID).

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    return Response.json(await connectorsView());
  } catch (err) {
    return fail(err, 502);
  }
}

// Elevated: only Weft's own window turns a connector off, never a thread's curl with the plain token.
export async function DELETE(req: Request) {
  const denied = elevated(req);
  if (denied) return denied;
  await connection();
  const q = new URL(req.url).searchParams;
  const worker = q.get("worker");
  try {
    const deps = { session: await accountClient().auth.getSession(), fetchFn: fetch, env: process.env };
    if (q.get("all") === "1") return Response.json({ ok: true, ...(await remoteDisconnect(deps)) });
    if (!worker) return Response.json({ error: "Say which worker." }, { status: 400 });
    const result = await remoteRevoke(worker, deps);
    return Response.json({ ok: true, note: revokeNote(result), ...result });
  } catch (err) {
    return fail(err, 502);
  }
}
