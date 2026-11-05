// A vault's recovery key, over HTTP (docs/architecture/teams-vault.md, "Recovery key").
//
//   GET  /api/team/vaults/<vaultId>/recovery?org=<slug>   the words, for a caller that has them
//   POST /api/team/vaults/<vaultId>/recovery              the "I've saved it" acknowledgement
//
// What this route is for. The recovery key's private half is 24 words the user writes down, and
// Weft never stores them — not in a file, not in the server, not in the event log, not in a thread.
// The words are made where the vault key is: in Electron main, behind a Touch ID. So the words are
// the *caller's* to send, and this route is the thin shell that records the show and hands them back.
//
// The route's own job is the record: it writes the recovery device row, the grant that seals the
// vault key to it, and the event row that says the key was shown — through
// private.share_vault_recovery, in one transaction. What crosses the wire is ciphertext: the public
// key and a sealed box. The words are never written down, here or anywhere.
//
// The gate is the same one every team route uses (app/api/team/devices/auth.ts): the caller's
// credential says who they are, and the workspace membership says whether they may act on the
// vault. A non-member gets the same 404 as a workspace that isn't there, so membership can't be
// probed by varying the slug.
import { connection } from "next/server";
import { z } from "zod";
import { deviceAccess } from "@/app/api/team/devices/auth";
import { vaultOrgId } from "@/app/api/team/devices/queries";
import { bearerSupabase, webClient } from "@/lib/web-session";

// The body of a GET: the recovery material the caller made in main, and the words that go with it.
// The words are 24 of them; the passphrase is not sent — the caller derived the keypair with it
// already, and the passphrase must never travel.
const ShowSchema = z.object({
  org: z.string().min(1),
  publicKey: z.string().min(1),
  wrappedKey: z.string().min(1),
  keyVersion: z.coerce.number().int().min(1).default(1),
  words: z.array(z.string().min(1)).length(24),
  // The "I've saved these words somewhere safe" tick. Without it the route refuses to make the
  // key: the words are shown once, so they are shown *after* the user says they can look after them.
  saved: z.literal(true),
});

// The body of a POST: the acknowledgement that the user saved the words.
const AckSchema = z.object({
  org: z.string().min(1),
  saved: z.literal(true),
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

// The client the write runs as: the caller's own session, so private.share_vault_recovery sees their
// auth.uid() and can check that they belong to the vault's workspace. A bearer caller (the desktop)
// gets a JWT-scoped client; a cookie caller gets the request's cookie client.
async function callerClient(req: Request) {
  return bearerSupabase(req) ?? (await webClient());
}

// GET: make (or re-make) the vault's recovery key and hand the words back.
//
// A re-show is a fresh key: the old recovery row is revoked by the same transaction, so the old
// words stop working the moment the new ones exist. The response carries the words and nothing
// else that is sensitive — no vault key, no private key, no passphrase.
export async function GET(req: Request, context: { params: Promise<{ vaultId: string }> }) {
  await connection();
  const { vaultId } = await context.params;
  const parsed = ShowSchema.safeParse(await readJson(req));
  if (!parsed.success) return badRequest("The recovery key needs 24 words, a public key, a sealed key and the saved tick.");
  const { org, publicKey, wrappedKey, keyVersion, words } = parsed.data;

  const access = await deviceAccess(req, org);
  if (access.kind === "unconfigured") return unconfigured();
  if (access.kind === "signed-out") return signedOut();
  if (access.kind === "denied") return notFound();
  const { ctx } = access;

  // The vault must be this workspace's vault. A vault id from another workspace is a 404, the same
  // as one that doesn't exist — the caller may not learn that it exists.
  const vaultOrg = await vaultOrgId(ctx.service, vaultId);
  if (vaultOrg !== ctx.org.id) return notFound();

  // The write, as the caller: the recovery device row, the grant, the event row — one transaction.
  const supabase = await callerClient(req);
  const { data: deviceId, error } = (await supabase.rpc("share_vault_recovery", {
    p_vault_id: vaultId,
    p_public_key: publicKey,
    p_wrapped_key: wrappedKey,
    p_key_version: keyVersion,
  })) as { data: string | null; error: { message: string } | null };
  if (error || !deviceId) return badRequest(error?.message ?? "The recovery key could not be made.");

  // The words go back to the caller that made them. They are not written down on the way past.
  return Response.json({ words, deviceId });
}

// POST: the "I've saved these words somewhere safe" acknowledgement.
//
// The words are already shown and already recorded by the GET; this is the user's word that they
// have them. The event log's row already says the key was shown — this one says the user confirmed
// they kept it, which is the thing an admin reads when they wonder whether the backup exists.
export async function POST(req: Request, context: { params: Promise<{ vaultId: string }> }) {
  await connection();
  const { vaultId } = await context.params;
  const parsed = AckSchema.safeParse(await readJson(req));
  if (!parsed.success) return badRequest("Missing workspace or the saved tick.");
  const { org } = parsed.data;

  const access = await deviceAccess(req, org);
  if (access.kind === "unconfigured") return unconfigured();
  if (access.kind === "signed-out") return signedOut();
  if (access.kind === "denied") return notFound();
  const { ctx } = access;

  const vaultOrg = await vaultOrgId(ctx.service, vaultId);
  if (vaultOrg !== ctx.org.id) return notFound();

  // The acknowledgement is an event row of its own: it carries no words and no key material.
  const { error } = await ctx.service.from("vault_events").insert({
    vault_id: vaultId,
    actor_user_id: ctx.user.id,
    action: "vault.recovery_shown",
    metadata: { acknowledged: true },
  });
  if (error) return badRequest(error.message);

  return Response.json({ ok: true });
}
