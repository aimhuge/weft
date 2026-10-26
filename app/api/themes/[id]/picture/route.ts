import fs from "node:fs";
import { guard } from "@/lib/guard";
import { THEME_ID } from "@/lib/custom-theme";
import { customThemePicture } from "@/lib/custom-themes";

// A prompted theme's picture. The id must be a plain folder name and the file one of the picture
// names the theme folder may hold (lib/custom-theme.ts PICTURES), so nothing else can be read.
// Not cached: a thread may repaint it while you watch.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  const { id } = await params;
  const picture = THEME_ID.test(id) ? customThemePicture(id) : null;
  if (!picture) return Response.json({ error: "No such theme picture." }, { status: 404 });
  try {
    const bytes = await fs.promises.readFile(picture.file);
    // An SVG is drawn by a thread: never let it run script if it's opened on its own.
    const headers: Record<string, string> = { "content-type": picture.type, "cache-control": "no-cache" };
    if (picture.type === "image/svg+xml") headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'";
    return new Response(bytes, { headers });
  } catch {
    return Response.json({ error: "Theme picture missing." }, { status: 404 });
  }
}
