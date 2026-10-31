// GET /api/web-board/[orgId]/page/[sha] — the iframe src for the page an open card's browser pane showed, on the
// weft.zip board (components/web-board/WebPane.tsx). Streams weft-blobs/<orgId>/<sha> through the visitor's own
// cookie session, so the bucket's "read as org member" policy is the gate: a non-member's download finds nothing.
// A blob already copied to R2 comes from there (docs/architecture/r2.md), once blob_mirror's own "read as org
// member" policy has shown the visitor its row: the same membership check, without a Supabase download.
// Sent with the share viewer's sandbox (app/api/s/[id]/page/[sha]): the page's scripts run in an opaque origin and
// can't read weft.zip's cookies. An HTML page's images come as `blob:sha256:` refs; they're signed as the visitor
// (lib/blob-page-sign.ts), since the sandboxed page's own requests carry no session cookie.
import { NO_STORE } from "@/lib/app-share-reply";
import { signPageAssets } from "@/lib/blob-page-sign";
import { mirroredShas } from "@/lib/blob-urls";
import { readBlob } from "@/lib/blob-read";
import { r2Config } from "@/lib/r2";
import { queueMirror } from "@/lib/r2-queue";
import { requestSession } from "@/lib/web-session";

const SHA_RE = /^[0-9a-f]{64}$/;
const ORG_RE = /^[0-9a-f-]{36}$/i;

const HEADERS = {
  "Content-Security-Policy": "sandbox allow-scripts allow-popups allow-forms",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, max-age=300",
} as const;

export async function GET(req: Request, ctx: { params: Promise<{ orgId: string; sha: string }> }) {
  const { orgId, sha } = await ctx.params;
  if (!SHA_RE.test(sha) || !ORG_RE.test(orgId)) return new Response("Bad request", { status: 400, headers: NO_STORE });
  const { supabase, user } = await requestSession(req);
  if (!user) return new Response("Sign in to see this page.", { status: 401, headers: NO_STORE });
  const r2 = r2Config();
  const inR2 = r2 ? (await mirroredShas(supabase, orgId, [sha])).has(sha) : false;
  const got = await readBlob(supabase, orgId, sha, { r2: inR2 ? r2 : null });
  if (!got) return new Response("Not found", { status: 404, headers: NO_STORE });
  if (r2 && got.from === "supabase") queueMirror(orgId)(sha);
  const type = got.type || "application/octet-stream";
  const body = type.startsWith("text/html") ? await signPageAssets(supabase, orgId, new TextDecoder().decode(got.bytes)) : got.bytes;
  return new Response(body, { status: 200, headers: { ...HEADERS, "Content-Type": type } });
}
