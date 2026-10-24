// GET /api/a/[id]/page/[sha] — a shared mini app's page at one version, the viewer's iframe src
// (lib/app-share-frame.ts). Refused unless the row still names this sha; a public link's answer is cached by
// Vercel's CDN on this URL (lib/app-share-serve.ts).
import { serveAppPage } from "@/lib/app-share-serve";

export async function GET(req: Request, ctx: { params: Promise<{ id: string; sha: string }> }) {
  const { id, sha } = await ctx.params;
  return serveAppPage(req, id, sha);
}
