import { connection } from "next/server";
import { AppShareError } from "@/lib/app-share";
import { describeApp, previewCard, refreshPreview } from "@/lib/app-share-preview-actions";
import { fail, guard } from "@/lib/guard";

// A shared mini app's link preview in its Share dialog (components/ShareAppPreview.tsx): GET ?id= the card a chat
// shows, PUT { id, description } your own words (null hands it back to the page), POST { id } makes it again.

function failed(err: unknown) {
  return fail(err, err instanceof AppShareError ? err.status : 500);
}

async function body(req: Request): Promise<Record<string, unknown> | null> {
  const parsed = (await req.json().catch(() => null)) as unknown;
  return parsed && typeof parsed === "object" && typeof (parsed as { id?: unknown }).id === "string" ? (parsed as Record<string, unknown>) : null;
}

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("Send ?id=.");
  try {
    return Response.json(await previewCard(id));
  } catch (err) {
    return failed(err);
  }
}

export async function PUT(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const b = await body(req);
  if (!b || !(typeof b.description === "string" || b.description === null)) return fail("Send { id, description }.");
  try {
    return Response.json(await describeApp(b.id as string, b.description));
  } catch (err) {
    return failed(err);
  }
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const b = await body(req);
  if (!b) return fail("Send { id }.");
  try {
    return Response.json(await refreshPreview(b.id as string));
  } catch (err) {
    return failed(err);
  }
}
