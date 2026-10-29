import { connection } from "next/server";
import { CardShareError, getCardShare, setCardShare } from "@/lib/card-share";
import { fail, guard } from "@/lib/guard";
import type { CardShareUpdate } from "@/lib/share-types";

// The Share dialog (components/ShareCardDialog.tsx): GET the card's share state, PUT a new mode (and password).
// The lib answers why a card can't be shared yet as a state, not an error; errors are a missing card,
// a refused mode or password, and Supabase failing.

function failed(err: unknown) {
  return fail(err, err instanceof CardShareError ? err.status : 500);
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const { id } = await params;
  try {
    return Response.json(await getCardShare(id));
  } catch (err) {
    return failed(err);
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Partial<CardShareUpdate> | null;
  if (!body || typeof body !== "object") return fail("Send { mode, password?, showChat?, slug? }.");
  try {
    return Response.json(await setCardShare(id, {
      mode: body.mode as CardShareUpdate["mode"],
      password: body.password,
      ...(typeof body.showChat === "boolean" ? { showChat: body.showChat } : {}),
      ...(typeof body.slug === "string" ? { slug: body.slug.trim() } : {}),
    }));
  } catch (err) {
    return failed(err);
  }
}
