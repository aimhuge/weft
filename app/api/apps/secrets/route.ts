// POST /api/apps/secrets — the Mac's `apps:push-secrets` uploads a share's author secrets + public values
// (electron/app-secrets-push.cjs). Auth: Bearer Supabase JWT, the same shape lib/web-session.ts's bearerUser
// accepts; the JWT's sub must match the share's created_by, so only the author (or the author of an org's
// share) can upload. Body: { shareId, values: { NAME: value, ... } }. Names not in the manifest's author
// secrets or public list are silently dropped, never silently broadened. A 4 MB cap on the body protects
// against a vault that slipped a giant file in.
import { connection } from "next/server";
import { appShareAccess } from "@/lib/app-share-access";
import { createAppSecretStore } from "@/lib/app-secret-store";
import { isConfigured as secretsConfigured } from "@/lib/app-secrets";
import { readNeeds } from "@/lib/app-read-needs";
import { NO_STORE, reject } from "@/lib/app-share-reply";
import { serviceClient, bearerUser } from "@/lib/web-session";

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const SHARE_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

// The names the share's manifest lets an author push: from:"author" or from:undefined secrets, the keys its
// named reads need, plus the public list. Anything else in the body is silently dropped — the Mac only sends those names, but we
// don't trust the wire to never disagree.
function allowedNames(manifest: unknown): Set<string> {
  const out = new Set<string>();
  if (!manifest || typeof manifest !== "object") return out;
  for (const name of authorSecretNames((manifest as { secrets?: unknown }).secrets)) out.add(name);
  // The keys the manifest's named reads run with on weft.zip (the read route asks for exactly these).
  for (const name of readNeeds(manifest)) out.add(name);
  const pub = (manifest as { public?: unknown }).public;
  if (Array.isArray(pub)) {
    for (const item of pub) {
      if (typeof item === "string" && NAME_RE.test(item)) out.add(item);
    }
  }
  return out;
}

// The manifest's `secrets` block, minus viewer secrets and names that aren't env-shaped.
function authorSecretNames(secrets: unknown): string[] {
  if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) return [];
  const out: string[] = [];
  for (const [name, rule] of Object.entries(secrets as Record<string, unknown>)) {
    if (!NAME_RE.test(name) || !rule || typeof rule !== "object") continue;
    if ((rule as Record<string, unknown>).from === "viewer") continue;
    out.push(name);
  }
  return out;
}

// Parses the body the Mac posts: { shareId, values }. Returns the typed pieces or an error Response
// ready to answer. Pulled out so the POST handler stays under the lint complexity budget.
async function parsePushBody(req: Request): Promise<{ shareId: string; values: Record<string, unknown> } | Response> {
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) return reject(413, "request body is too large.");
  let body: unknown;
  try { body = await req.json(); } catch { return reject(400, "request body must be JSON."); }
  if (!body || typeof body !== "object") return reject(400, "request shape isn't valid.");
  const m = body as Record<string, unknown>;
  const shareId = typeof m.shareId === "string" ? m.shareId : "";
  const values = m.values && typeof m.values === "object" && !Array.isArray(m.values) ? (m.values as Record<string, unknown>) : null;
  if (!SHARE_ID_RE.test(shareId)) return reject(400, "shareId isn't valid.");
  if (!values) return reject(400, "values must be an object.");
  return { shareId, values };
}

// One push: takes the parsed body + the allowed names from the manifest and writes each value through the
// store. Names in the body but not in `allowed` are silently dropped; one failed write logs and continues
// so the other names still go up, and is listed in `failed` for the route to answer with.
async function runPush(store: ReturnType<typeof createAppSecretStore>, shareId: string, values: Record<string, unknown>, allowed: Set<string>): Promise<{ pushed: string[]; dropped: string[]; failed: string[] }> {
  const pushed: string[] = [];
  const dropped: string[] = [];
  const failed: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    if (typeof value !== "string" || !value) continue;
    if (!allowed.has(name)) { dropped.push(name); continue; }
    try {
      await store.setValue(shareId, name, null, value);
      pushed.push(name);
    } catch (err) {
      console.error(`apps/secrets: setValue failed for ${name}: ${err instanceof Error ? err.message : String(err)}`);
      failed.push(name);
    }
  }
  return { pushed, dropped, failed };
}

export async function POST(req: Request): Promise<Response> {
  await connection();
  const parsed = await parsePushBody(req);
  if (parsed instanceof Response) return parsed;
  const { shareId, values } = parsed;

  const user = await bearerUser(req);
  if (!user) return reject(401, "Bearer token is missing or invalid.");

  const access = await appShareAccess(shareId);
  if (access.kind === "missing") return reject(404, "this app link no longer exists.");
  if (access.kind !== "ok") return reject(403, "you don't have access to this app link.");
  // Only the author (or an org's author of an org-owned share) may upload. The same shape the
  // app-share-access's userPrivateVerdict uses for read access.
  if (access.share.created_by !== user.id) return reject(403, "you didn't create this app link.");

  const allowed = allowedNames(access.share.manifest);
  if (allowed.size === 0) return reject(400, "this app declares no author secrets or public values.");

  if (!secretsConfigured()) return reject(503, "App secrets aren't set up on this server.");
  const service = serviceClient();
  if (!service) return reject(503, "this server isn't configured to run apps.");

  const out = await runPush(createAppSecretStore(service), shareId, values, allowed);
  // A 200 here reads as "Uploaded …" on the Mac, so a name that didn't store fails the whole answer.
  if (out.failed.length) return reject(500, `couldn't store ${out.failed.join(", ")}.`);
  return Response.json(out, { headers: NO_STORE });
}