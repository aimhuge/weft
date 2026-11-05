// GET /api/s/[id]/og — a public thread link's preview picture (lib/share-meta.ts): the mini app's branded card
// (lib/app-card-image.tsx) with the card's emoji, title, first ask and its pane capture tilted in. Only for a
// public link; anything else is a 404, so a gated thread's capture never leaves weft.zip. The ?v= the metadata
// adds changes with the preview, so a long cache is safe.
import { appCardImage } from "@/lib/app-card-image";
import { blobBytes } from "@/lib/app-share-meta";
import { BLOB_REF_PREFIX } from "@/lib/cloud-sync-types";
import { loadShare } from "@/lib/share-access";
import { threadPreview } from "@/lib/share-meta";
import { NO_STORE } from "@/lib/share-page-serve";
import { serviceClient } from "@/lib/web-session";

const CACHE = { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" };

async function byline(service: NonNullable<ReturnType<typeof serviceClient>>, userId: string | undefined): Promise<string> {
  if (!userId) return "weft.zip";
  const { data } = await service.from("profiles").select("username").eq("id", userId).maybeSingle<{ username: string | null }>();
  return data?.username ? `@${data.username}` : "weft.zip";
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const service = serviceClient();
  if (!service) return new Response("Sharing isn't set up on this server.", { status: 503, headers: NO_STORE });
  const loaded = await loadShare(id);
  const preview = await threadPreview(service, loaded);
  if (!loaded || !preview) return new Response("Not found", { status: 404, headers: NO_STORE });
  const sha = preview.thumb?.slice(BLOB_REF_PREFIX.length);
  const [shot, by] = await Promise.all([sha ? blobBytes(service, loaded.share.org_id, sha) : null, byline(service, loaded.share.created_by)]);
  return appCardImage({ name: preview.name, title: preview.title, description: preview.description, byline: by, shot }, { headers: CACHE });
}
