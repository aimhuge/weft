import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { listCustomThemes, startThemeCard, type UploadedPicture } from "@/lib/custom-themes";
import { getCard } from "@/lib/store";

// Themes you prompted up (lib/custom-themes.ts): GET lists the finished ones for Settings → Appearance,
// POST { prompt } starts the thread that paints a new one. POST as multipart (prompt, picture) brings your
// own picture: it's kept as the backdrop and the thread writes the theme around it.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  return Response.json({ themes: listCustomThemes() });
}

async function readRequest(req: Request): Promise<{ prompt?: unknown; picture?: UploadedPicture }> {
  if (!req.headers.get("content-type")?.startsWith("multipart/form-data")) return (await req.json()) as { prompt?: unknown };
  const form = await req.formData();
  const file = form.get("picture");
  if (!(file instanceof File)) return { prompt: form.get("prompt") };
  return { prompt: form.get("prompt"), picture: { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name } };
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const { prompt, picture } = await readRequest(req);
    const { id, card } = startThemeCard(typeof prompt === "string" ? prompt : "", picture);
    return Response.json({ id, card: getCard(card.id) });
  } catch (err) {
    return fail(err);
  }
}
