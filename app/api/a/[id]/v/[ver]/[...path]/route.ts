// GET /api/a/<id>/v/<ver>/<...path> — one file of a folder app at one version of its files map, the viewer's
// iframe src and every sibling it loads by relative URL (lib/app-share-frame.ts). Refused unless the row's files
// map still has this version; a public link's answers are cached by Vercel's CDN on this URL
// (lib/app-share-serve.ts).
import { serveAppFile } from "@/lib/app-share-serve";
import { VERSION_RE } from "@/lib/app-share-frame";
import { NO_STORE } from "@/lib/app-share-reply";

export async function GET(req: Request, ctx: { params: Promise<{ id: string; ver: string; path: string[] }> }) {
  const { id, ver, path } = await ctx.params;
  if (!VERSION_RE.test(ver)) return new Response("Not found", { status: 404, headers: NO_STORE });
  return serveAppFile(req, id, path, ver);
}
