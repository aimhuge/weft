import { connection } from "next/server";
import { elevated, fail, guard } from "@/lib/guard";
import { listDevices, moveThreads, revokeDevice } from "@/lib/device-registry";

// Settings → Devices (components/DevicesSettings.tsx, lib/use-devices.ts, docs/architecture/device-registry.md): GET
// lists every device of yours from the one registry, whatever its kind; DELETE ?id= revokes one through device_revoke;
// POST { from, to } moves one worker's threads onto another (worker_move_cards).
// A phone or browser this Mac pinned is revoked over IPC instead (window.weft.pairing.revoke), which also unpins it
// here and rotates the workspace key; this route covers the rest.

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    return Response.json(await listDevices());
  } catch (err) {
    return fail(err, 502);
  }
}

// Elevated: only Weft's own window revokes, never a thread's curl with the plain token.
export async function DELETE(req: Request) {
  const denied = elevated(req);
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Say which device." }, { status: 400 });
  try {
    return Response.json({ ok: true, ...(await revokeDevice(id)) });
  } catch (err) {
    return fail(err, 502);
  }
}

// Elevated like Revoke: moving threads re-points what a worker may publish, so only Weft's own window does it.
export async function POST(req: Request) {
  const denied = elevated(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { from?: unknown; to?: unknown };
  if (typeof body.from !== "string" || typeof body.to !== "string" || !body.from || !body.to) return Response.json({ error: "Say which workers." }, { status: 400 });
  try {
    return Response.json({ ok: true, ...(await moveThreads(body.from, body.to)) });
  } catch (err) {
    return fail(err, 502);
  }
}
