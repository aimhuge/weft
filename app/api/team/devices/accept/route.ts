// POST /api/team/devices/accept — the accepting side of the TOFU handshake.
//
// The granter asked to add a device (app/api/team/devices wrote a `pending_device_grants` row). The
// other machine heard about it, the user compared the fingerprint on both screens, and this is the
// "Accept" that says "yes, that's the same string".
//
// Accepting writes two columns on the pending row: `matched_device_id` (which of the target's machines
// the fingerprint belongs to) and `target_public_key` (that machine's public key). The granter's Weft
// then seals the vault key to `target_public_key` — the wrap happens on the granter's machine, because
// that is the only place the unwrapped vault key exists.
//
// Two rules this route keeps, both of them the point of the whole flow:
//
//   1. Only the *target* of the grant may accept it. The RLS on `pending_device_grants` says the same
//      thing ("target accept" requires `target_user_id = auth.uid()`).
//   2. The public key comes from the `devices` table, never from the request body. A caller that names
//      somebody else's device id gets their own device's key or nothing at all; it can never make the
//      granter seal the vault key to a key the caller chose.
//
// What comes back is a public key — the one half of a keypair, meant to be public. The vault key, the
// wrapped key and every secret value stay out of this route entirely.
import { connection } from "next/server";
import { z } from "zod";
import { deviceAccess } from "../auth";
import { findDevice, findPendingGrant, vaultOrgId } from "../queries";

const AcceptSchema = z.object({
  org: z.string().min(1),
  pendingId: z.string().min(1),
  // The device on the accepting machine that the fingerprint belongs to.
  deviceId: z.string().min(1),
});

function unconfigured() {
  return Response.json({ error: "unconfigured" }, { status: 503 });
}
function signedOut() {
  return Response.json({ error: "signed-out" }, { status: 401 });
}
function notFound() {
  return Response.json({ error: "not-found" }, { status: 404 });
}
function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  await connection();
  const parsed = AcceptSchema.safeParse(await readJson(req));
  if (!parsed.success) return badRequest("Missing workspace, grant or device.");
  const { org, pendingId, deviceId } = parsed.data;
  const access = await deviceAccess(req, org);
  if (access.kind === "unconfigured") return unconfigured();
  if (access.kind === "signed-out") return signedOut();
  if (access.kind === "denied") return notFound();
  const { ctx } = access;

  // The grant, read back. It has to be this workspace's grant, it has to still be waiting, and it has to
  // be addressed to the caller — a granter can't accept their own request, and a bystander can't accept
  // someone else's.
  const grant = await findPendingGrant(ctx.service, pendingId);
  if (!grant) return notFound();
  const grantOrg = await vaultOrgId(ctx.service, grant.vault_id);
  if (grantOrg !== ctx.org.id) return notFound();
  if (grant.target_user_id !== ctx.user.id) return Response.json({ error: "forbidden" }, { status: 403 });
  if (grant.status !== "pending") return badRequest("That grant isn't waiting any more.");

  // The device, read back. It has to be one of the caller's own, and it has to be live (a revoked
  // device can't be granted anything). Its fingerprint is the one the granter is holding — if it isn't
  // the same, the user compared the two screens wrongly and must not accept.
  const device = await findDevice(ctx.service, deviceId);
  if (!device || device.user_id !== ctx.user.id) return notFound();
  if (device.revoked_at) return badRequest("That device has been revoked.");

  // The fingerprint check, one more time on the server. The user compared the two strings by eye; this
  // compares them for real, so a paste that drifted (a transposed group, a stale screen) is caught
  // before the vault key is sealed to the wrong key.
  if (device.fingerprint.replace(/[^0-9a-f]/g, "") !== grant.target_fingerprint.replace(/[^0-9a-f]/g, "")) {
    return badRequest("That device's fingerprint doesn't match the one you were sent.");
  }

  // Accept: record which device was matched and its public key. The public key is the granter's Weft's
  // input for the wrap — it is public by construction.
  const { error } = await ctx.service
    .from("pending_device_grants")
    .update({ matched_device_id: device.id, target_public_key: device.public_key, status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", pendingId)
    .eq("status", "pending");
  if (error) return Response.json({ error: error.message }, { status: 400 });

  // The answer: the public key the granter's Weft seals the vault key to. Nothing else — no wrapped
  // key, no vault key, no value.
  return Response.json({ ok: true, deviceId: device.id, publicKey: device.public_key, fingerprint: device.fingerprint });
}
