// The team's Devices API on weft.zip.
//
//   GET    /api/team/devices?org=<slug>   the devices and the pending grants
//   POST   /api/team/devices              ask to add a device (admin only)
//   DELETE /api/team/devices              drop a pending grant
//
// POST is the first step of the TOFU handshake: it writes a `pending_device_grants` row and nothing
// else. No `vault_grants` row is written here — the vault key is sealed only after the other machine has
// shown the same fingerprint, and only by the granter's own Weft (card 8).
//
// The route is a thin wrapper over lib/team-devices-view's shapes and the queries in ./queries.ts; the
// gate is ./auth.ts. No secret value is read, written or returned here — a device's public key and
// fingerprint are metadata, and the vault key never reaches this server at all.
import { connection } from "next/server";
import { z } from "zod";
import { normalizeFingerprint } from "@/lib/team-devices-view";
import { canGrantDevices, deviceAccess } from "./auth";
import { findPendingGrant, listPendingGrants, listTeamDevices, vaultOrgId } from "./queries";

// The body of a POST: the workspace, the vault the device is being added to, whose machine it is, and
// the fingerprint the user read off it. The fingerprint is the TOFU token — the other machine shows the
// same string, and the two have to match before the vault key is sealed.
const CreateSchema = z.object({
  org: z.string().min(1),
  vaultId: z.string().min(1),
  targetUserId: z.string().min(1),
  fingerprint: z.string().min(1),
});

const DeleteSchema = z.object({
  org: z.string().min(1),
  pendingId: z.string().min(1),
});

// The answers the route gives, matching app/api/teams: 401 signed-out, 404 not-found (a non-member
// can't tell a workspace that doesn't exist from one they can't see), 503 unconfigured, 400 bad-request.
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

// The body, parsed. A malformed body is a 400 rather than a thrown error.
async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// GET: the devices across the workspace and the grants waiting on a TOFU check. Every member may read
// this — the roster of machines is the same thing the Roster shows for people. The service client does
// the read (the list crosses users) and scopes itself to the workspace's members.
export async function GET(req: Request) {
  await connection();
  const org = new URL(req.url).searchParams.get("org") ?? "";
  if (!org) return badRequest("Missing workspace.");
  const access = await deviceAccess(req, org);
  if (access.kind === "unconfigured") return unconfigured();
  if (access.kind === "signed-out") return signedOut();
  if (access.kind === "denied") return notFound();
  const { ctx } = access;
  const [devices, pending] = await Promise.all([listTeamDevices(ctx.service, ctx.org.id, ctx.user.id), listPendingGrants(ctx.service, ctx.org.id, ctx.user.id)]);
  return Response.json({ devices, pending, canGrant: canGrantDevices(ctx) });
}

// POST: ask to add a device to one of the workspace's vaults. Admin only — the grant hands a machine
// the right to hold the workspace's vault key.
//
// The vault and the target user are both checked against the workspace before the row is written, so a
// grant can't point at another workspace's vault or at a user who isn't in the workspace. The row that
// comes out of this is a *request*: it holds a fingerprint and nothing else.
export async function POST(req: Request) {
  await connection();
  const parsed = CreateSchema.safeParse(await readJson(req));
  if (!parsed.success) return badRequest("Missing workspace, vault, device owner or fingerprint.");
  const { org, vaultId, targetUserId, fingerprint } = parsed.data;
  const access = await deviceAccess(req, org);
  if (access.kind === "unconfigured") return unconfigured();
  if (access.kind === "signed-out") return signedOut();
  if (access.kind === "denied") return notFound();
  const { ctx } = access;
  if (!canGrantDevices(ctx)) return Response.json({ error: "forbidden" }, { status: 403 });
  // The fingerprint the user pasted has to be a fingerprint: 16 bytes of hex. The device side writes the
  // same 32 characters into `devices.fingerprint`, so the two compare equal.
  const normalized = normalizeFingerprint(fingerprint);
  if (!normalized) return badRequest("That isn't a device fingerprint. Copy it from the other machine's Weft.");
  // The vault must be this workspace's vault.
  const vaultOrg = await vaultOrgId(ctx.service, vaultId);
  if (vaultOrg !== ctx.org.id) return notFound();
  // The target must be in the workspace. (A grant to somebody who isn't would never be heard about.)
  const { data: member } = await ctx.service.from("org_memberships").select("user_id").eq("org_id", ctx.org.id).eq("user_id", targetUserId).maybeSingle<{ user_id: string }>();
  if (!member) return notFound();
  // The grant itself. `granter_user_id` is the caller — the RLS on this table requires exactly that,
  // and the admin check above is the second half of the same rule.
  const { data: grant, error } = await ctx.service
    .from("pending_device_grants")
    .insert({ vault_id: vaultId, granter_user_id: ctx.user.id, target_user_id: targetUserId, target_fingerprint: normalized, status: "pending" })
    .select("id")
    .single<{ id: string }>();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true, id: grant.id });
}

// DELETE: drop a pending grant. Either side may: the granter who asked for it (they changed their mind)
// or the target who doesn't want the device added. The grant row is gone either way; nothing was sealed
// yet, so nothing has to be unwound.
export async function DELETE(req: Request) {
  await connection();
  const parsed = DeleteSchema.safeParse(await readJson(req));
  if (!parsed.success) return badRequest("Missing workspace or grant.");
  const { org, pendingId } = parsed.data;
  const access = await deviceAccess(req, org);
  if (access.kind === "unconfigured") return unconfigured();
  if (access.kind === "signed-out") return signedOut();
  if (access.kind === "denied") return notFound();
  const { ctx } = access;
  // The grant has to exist and be this workspace's: the vault it points at is in this workspace.
  const grant = await findPendingGrant(ctx.service, pendingId);
  if (!grant) return notFound();
  const grantOrg = await vaultOrgId(ctx.service, grant.vault_id);
  if (grantOrg !== ctx.org.id) return notFound();
  // Only the two people in the grant may drop it.
  if (grant.granter_user_id !== ctx.user.id && grant.target_user_id !== ctx.user.id) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const { error } = await ctx.service.from("pending_device_grants").delete().eq("id", pendingId);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
