// POST /api/team/vaults/<vaultId>/rotate — rotate a shared vault's key around a removed device.
//
//   POST /api/team/vaults/<vaultId>/rotate?org=<slug>
//
// What this route is for. A rotate (docs/architecture/teams-vault.md, "Removal and rotation") is the
// heavier half of removing a teammate: the vault's key changes, so the plaintext the removed party
// held stops being worth anything, and the values have to be changed at their providers too.
//
// The crypto is not here. The new vault key is made in Electron main, on the admin's own machine,
// because that is the only place a vault key exists — the server never holds one, and this route
// never sees one. What the desktop sends here is the *plan*: the sealed key for each remaining
// device, and each value re-encrypted under the new key.
//
// The write itself is lib/team-vault-rotate.ts's applyRotate, the same writer the remove-member
// action uses. It runs as the service client, because the RLS policy "vault_grants: own device
// insert" only lets a user write a grant for a device they own — which is exactly what stops an
// admin's desktop from granting the new key to a *teammate's* machine. The same problem the
// recovery key had, and the same answer: the write runs as the service client, the way
// private.share_vault_recovery does for the recovery row. The gate here is the admin check below,
// and the plan's own contents are the sealed boxes the desktop computed.
//
// What crosses this boundary: sealed boxes (a libsodium crypto_box_seal over each device's public
// key), ciphertext, and names. Never a vault key, never a plaintext value, never a secret's value.
import { connection } from "next/server";
import { z } from "zod";
import { canGrantDevices, deviceAccess } from "@/app/api/team/devices/auth";
import { vaultOrgId } from "@/app/api/team/devices/queries";
import { applyRotate, type RotatePlan } from "@/lib/team-vault-rotate";

// The body: the workspace, the device being removed, the new key version, and the plan the desktop
// computed. The wrapped keys and the ciphertext are opaque strings here — this route moves them, it
// never opens them.
const RotateSchema = z.object({
  org: z.string().min(1),
  removedDeviceId: z.string().min(1),
  keyVersion: z.coerce.number().int().min(2),
  previousKeyVersion: z.coerce.number().int().min(1),
  grants: z.array(z.object({ deviceId: z.string().min(1), wrappedKey: z.string().min(1) })).min(1),
  secrets: z.array(
    z.object({
      name: z.string().min(1),
      environment: z.string().min(1),
      ciphertext: z.string(),
      nonce: z.string(),
      rowVersion: z.coerce.number().int().min(0),
      blank: z.boolean().optional(),
    }),
  ),
  namesToRotate: z.array(z.string().min(1)),
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

// The body, parsed. A malformed body is a 400 rather than a thrown error.
async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// POST: write the rotate.
//
// The order matters. The grants go in first: a device that has no grant for the new key version
// can't open anything under it, and the removed device must not get one. Then the version bump, so
// the vault's current key version is the one the grants are for. Then the re-encrypted rows. Then the
// revocation, so the removed device can't fetch a new grant even if it tries. Then the event row.
//
// The removed device's *old* grants are left in place for one cycle (docs/architecture/teams-vault.md,
// "Removal and rotation"): a teammate who was offline at rotate time can still open what was
// encrypted under the old version, and re-encrypts it under the new one on their next sync.
export async function POST(req: Request, context: { params: Promise<{ vaultId: string }> }) {
  await connection();
  const { vaultId } = await context.params;
  const parsed = RotateSchema.safeParse(await readJson(req));
  if (!parsed.success) return badRequest("Missing workspace, device or key version.");
  const { org, removedDeviceId, keyVersion, previousKeyVersion, grants, secrets, namesToRotate } = parsed.data;

  const access = await deviceAccess(req, org);
  if (access.kind === "unconfigured") return unconfigured();
  if (access.kind === "signed-out") return signedOut();
  if (access.kind === "denied") return notFound();
  const { ctx } = access;

  // Only an admin may rotate: a rotate takes a teammate's access away.
  if (!canGrantDevices(ctx)) return Response.json({ error: "forbidden" }, { status: 403 });

  // The vault must be this workspace's vault. A vault id from another workspace is a 404, the same as
  // one that doesn't exist — the caller may not learn that it exists.
  const vaultOrg = await vaultOrgId(ctx.service, vaultId);
  if (vaultOrg !== ctx.org.id) return notFound();

  const plan: RotatePlan = { vaultId, keyVersion, previousKeyVersion, revokedDeviceId: removedDeviceId, grants, secrets, namesToRotate };
  const result = await applyRotate(ctx.service, plan, { userId: ctx.user.id, email: ctx.user.email });
  if (!result.ok) return badRequest(result.error);

  return Response.json({ ok: true, keyVersion: result.keyVersion, namesToRotate: result.namesToRotate });
}
