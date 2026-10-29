// POST /api/web-board/[orgId]/blob-urls — URLs for the blob refs the weft.zip board is about to draw (thumbnails,
// a thread's screenshots), for components/web-board/useWebBoard.ts. R2's presigned URLs need the server's key, so
// the browser can't sign them itself the way it signs Supabase's. Runs as the visitor's own session: blob_mirror's
// and the bucket's "read as org member" policies are the access check, so a non-member gets an empty map. The phone
// app calls it too, with `Authorization: Bearer` (requestSession).
// docs/architecture/r2.md.
import { NO_STORE } from "@/lib/app-share-reply";
import { resolveBlobUrls } from "@/lib/blob-urls";
import { isBlobRef } from "@/lib/cloud-sync-types";
import { queueMirror } from "@/lib/r2-queue";
import { requestSession } from "@/lib/web-session";

const ORG_RE = /^[0-9a-f-]{36}$/i;
const MAX_REFS = 200;

export async function POST(req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await ctx.params;
  if (!ORG_RE.test(orgId)) return new Response("Bad request", { status: 400, headers: NO_STORE });
  const body = (await req.json().catch(() => null)) as { refs?: unknown } | null;
  const refs = Array.isArray(body?.refs) ? [...new Set(body.refs.filter((r): r is string => typeof r === "string" && isBlobRef(r)))].slice(0, MAX_REFS) : [];
  const { supabase, user } = await requestSession(req);
  if (!user) return new Response("Sign in first.", { status: 401, headers: NO_STORE });
  const urls = await resolveBlobUrls(supabase, orgId, refs, { onUnmirrored: queueMirror(orgId) });
  return Response.json({ urls }, { headers: NO_STORE });
}
