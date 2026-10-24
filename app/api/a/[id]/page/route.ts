// GET /api/a/[id]/page — a shared mini app's page, the unversioned URL viewers framed before
// /api/a/[id]/page/[sha] (lib/app-share-frame.ts). Gated on every request and never CDN-cached; it serves only the
// one blob the share row names, with the bridge script after <head> (lib/app-share-serve.ts).
import { serveAppPage } from "@/lib/app-share-serve";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return serveAppPage(req, id);
}
