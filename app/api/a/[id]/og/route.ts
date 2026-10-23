// GET /api/a/[id]/og — a public mini app link's preview picture (lib/app-share-meta.ts): the branded card
// (lib/app-card-image.tsx) with the Mac's capture of the app, or the folder app's own image when weft-app.json or its
// page names one. Only for a public link; anything else is a 404, so a gated app's screenshot never leaves weft.zip.
// The ?v= the metadata adds changes with the preview, so a long cache is safe.
import { appCardImage, imageType } from "@/lib/app-card-image";
import { blobRefSha } from "@/lib/app-preview";
import { loadAppShare } from "@/lib/app-share-access";
import { blobBytes, publicPreview, shareByline } from "@/lib/app-share-meta";
import { NO_STORE } from "@/lib/share-page-serve";
import { serviceClient } from "@/lib/web-session";

const CACHE = { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" };

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const service = serviceClient();
  if (!service) return new Response("Sharing isn't set up on this server.", { status: 503, headers: NO_STORE });
  const share = await loadAppShare(service, id);
  const preview = publicPreview(share);
  if (!share || !preview) return new Response("Not found", { status: 404, headers: NO_STORE });
  const ownSha = blobRefSha(preview.image);
  const own = ownSha ? await blobBytes(service, share.org_id, ownSha) : null;
  const ownType = own ? imageType(own) : null;
  if (own && ownType) return new Response(own, { headers: { ...CACHE, "Content-Type": ownType, "X-Content-Type-Options": "nosniff" } });
  const shotSha = blobRefSha(preview.shot);
  const [shot, byline] = await Promise.all([shotSha ? blobBytes(service, share.org_id, shotSha) : null, shareByline(service, share)]);
  return appCardImage({ name: share.name, title: preview.title, description: preview.description, byline, shot }, { headers: CACHE });
}
