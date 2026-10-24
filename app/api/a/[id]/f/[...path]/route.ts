// GET /api/a/<id>/f/<...path> — one file in a folder app, the unversioned URL viewers framed before
// /api/a/<id>/v/<ver>/<...path> (lib/app-share-frame.ts). Gated on every request and never CDN-cached; the path
// must be exactly a key of the share's files map, and HTML gets the bridge script (lib/app-share-serve.ts).
import { serveAppFile } from "@/lib/app-share-serve";

export async function GET(req: Request, ctx: { params: Promise<{ id: string; path: string[] }> }) {
  const { id, path } = await ctx.params;
  return serveAppFile(req, id, path);
}
