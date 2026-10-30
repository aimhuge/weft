// GET /api/s/[id]/page/[sha] — the iframe src for a shared page. Streams the file (lib/share-page-serve.ts) from
// weft-blobs/<orgId>/<sha> with a strict CSP sandbox so the page's scripts run in an opaque origin
// and can't read weft.zip's cookies. The viewer can frame the page; a provider that refuses
// framing (X-Frame-Options) is the iframe's loss, and the page also offers an "Open ↗" link.
//
// Access is gated by the same shareAccess verdict the live route uses; the same id resolves to
// the same share, so a private visitor gets 403, a gated visitor gets 403, and a deleted card
// gets 404. The sha is validated as 64 hex chars so an attacker can't probe storage paths, and it must be the blob of
// THIS card's current pane: a share link is for one card, not for every file the workspace has uploaded. The page's
// own images are the exception: the refs the owner's upload wrote into it are signed (lib/blob-page-sign.ts).
import { shareAccess } from "@/lib/share-access";
import { loadPaneAcrossThread } from "@/lib/share-live";
import { NO_STORE, serveBlobPage, SHA_RE } from "@/lib/share-page-serve";
import { serviceClient } from "@/lib/web-session";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; sha: string }> }) {
  const { id, sha } = await ctx.params;
  if (!SHA_RE.test(sha)) return new Response("Bad request", { status: 400 });
  const access = await shareAccess(id);
  if (access.kind !== "ok") return new Response("Forbidden", { status: 403, headers: NO_STORE });
  const service = serviceClient();
  if (!service) return new Response("Sharing isn't set up on this server.", { status: 503, headers: NO_STORE });
  const { org_id: orgId, card_id: cardId } = access.share.share;
  const pane = await loadPaneAcrossThread(service, orgId, cardId);
  if (pane?.kind !== "blob" || pane.ref !== `blob:sha256:${sha}`) return new Response("Not found", { status: 404, headers: NO_STORE });
  return serveBlobPage(service, orgId, sha, { signAssets: true });
}
