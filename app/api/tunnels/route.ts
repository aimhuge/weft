import { fail, guard } from "@/lib/guard";
import { closeTunnel, listTunnels, openTunnel } from "@/lib/tunnels";

// The 🪝 drawer's tunnels (lib/use-tunnels.ts, docs/architecture/tunnels.md): GET ?folder= lists the open ones (repeat
// folder for several), POST { folder, target, hours? } opens one after Touch ID, and DELETE ?id= closes one.

export function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  const folders = new URL(req.url).searchParams.getAll("folder");
  return Response.json({ tunnels: listTunnels(folders) });
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as { folder?: unknown; target?: unknown; hours?: unknown };
    if (typeof body.folder !== "string" || typeof body.target !== "string") return Response.json({ error: "Say which project and which local address." }, { status: 400 });
    const hours = typeof body.hours === "number" ? body.hours : undefined;
    return Response.json({ tunnel: await openTunnel({ folder: body.folder, target: body.target, hours }) });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Provide the tunnel's id." }, { status: 400 });
  try {
    await closeTunnel(id);
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
