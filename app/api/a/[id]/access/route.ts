// GET /api/a/<id>/access — a hosted mini app's weft.access() (and requestAccess / revoke, which the bridge sends
// the same way): the Mac's data-app access shape, { project, env, needs, missing, granted }, so a page written for
// the Mac's pane (Growth) runs on weft.zip unchanged. On weft.zip the grant is the author's upload: the reads run
// with the author's values (lib/app-read-needs.ts names them), so `granted` is always true and `missing` lists the
// names the author hasn't sent with Upload secrets yet. Names only, never values.
import { connection } from "next/server";
import { appShareAccess } from "@/lib/app-share-access";
import { NO_STORE, reject } from "@/lib/app-share-reply";
import { isConfigured as secretsConfigured } from "@/lib/app-secrets";
import { createAppSecretStore } from "@/lib/app-secret-store";
import { readNeeds } from "@/lib/app-read-needs";
import { serviceClient } from "@/lib/web-session";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await ctx.params;

  const access = await appShareAccess(id);
  if (access.kind === "missing") return reject(404, "this app link no longer exists.");
  if (access.kind !== "ok") return reject(403, "you don't have access to this app link.");

  const service = serviceClient();
  if (!service) return reject(503, "this server isn't configured to run apps.");

  const manifest = access.share.manifest as { env?: unknown } | null;
  const needs = readNeeds(manifest);
  const store = secretsConfigured() ? createAppSecretStore(service) : null;
  const missing: string[] = [];
  for (const name of needs) {
    if (!store || !(await store.hasValue(id, name, null))) missing.push(name);
  }
  const env = typeof manifest?.env === "string" ? manifest.env : "production";
  return Response.json({ project: access.share.name, env, needs, missing, granted: true }, { headers: NO_STORE });
}
