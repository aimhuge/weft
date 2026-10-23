import { connection } from "next/server";
import { launch, LaunchRefused, listLaunchers } from "@/lib/dev-launchers";
import { restartDev } from "@/lib/devserver";
import { fail, guard } from "@/lib/guard";
import { killProc, killService, ServiceRefused } from "@/lib/services-kill";
import { listServices, machineInfo } from "@/lib/services-snapshot";

// The rail's Services drawer: every process Weft spawned, grouped by what started it, with CPU and
// memory (lib/services-snapshot.ts). Reads need no x-weft-token header; writes do (guard()).
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const [services, launchers] = await Promise.all([listServices(), listLaunchers()]);
  return Response.json({ services, launchers, machine: machineInfo() });
}

// kill: end a service by id, or one process in it by pid. restart: start a Weft dev server again
// (`dev:<cardId>`) with its original command, folder, url and title. launch: start a working folder's
// dev command, or restart the run already serving it; answers which it did.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const { action, id, pid, cwd, command } = (await req.json().catch(() => ({}))) as { action?: string; id?: string; pid?: number; cwd?: string; command?: string };
  try {
    if (action === "launch" && cwd && command) return Response.json({ ok: true, ...(await launch(cwd, command)) });
    if (action === "kill" && typeof pid === "number") await killProc(pid);
    else if (action === "kill" && id) await killService(id);
    else if (action === "restart" && id?.startsWith("dev:")) await restartDev(id.slice(4));
    else return fail("Unknown action.");
  } catch (err) {
    if (err instanceof ServiceRefused || err instanceof LaunchRefused) return fail(err, 403);
    throw err;
  }
  return Response.json({ ok: true });
}
