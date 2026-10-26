import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { installJobs, isInstallKey, startInstall } from "@/lib/simulator-install";
import { INSTALLERS } from "@/lib/simulator-install-steps";

// Settings → Connectors → Simulators → Install: GET the fixes running or finished, POST { key } to start one.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  return Response.json(installJobs());
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const { key } = (await req.json().catch(() => ({}))) as { key?: unknown };
  if (!isInstallKey(key)) return fail(new Error(`Weft can't install ${String(key)}.`));
  return Response.json(startInstall(key, INSTALLERS));
}
