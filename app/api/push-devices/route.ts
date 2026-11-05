import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { listPushDevices, removePushDevice } from "@/lib/push-devices";

// Settings → Sync → Phones (components/PhoneSettings.tsx, lib/use-push-devices.ts): GET lists the phones paired
// to your account, DELETE ?id= unpairs one.

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    return Response.json(await listPushDevices());
  } catch (err) {
    return fail(err, 502);
  }
}

export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Provide the phone's id." }, { status: 400 });
  try {
    await removePushDevice(id);
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err, 502);
  }
}
