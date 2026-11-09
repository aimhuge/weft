import { connection } from "next/server";
import { CardShareError } from "@/lib/card-share";
import { grantShare, listShareGrants, revokeShareGrant } from "@/lib/card-share-grants";
import { fail, guard } from "@/lib/guard";
import type { GrantRequest } from "@/lib/share-grant-types";

// The people a card is shared with by GitHub account (lib/card-share-grants.ts, docs/architecture/sharing.md#people):
// GET lists them, POST { logins, via, note? } names more (and asks weft.zip to tell them), DELETE ?github=<id> removes one.

function failed(err: unknown) {
  return fail(err, err instanceof CardShareError ? err.status : 500);
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const { id } = await params;
  try {
    return Response.json(await listShareGrants(id));
  } catch (err) {
    return failed(err);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Partial<GrantRequest> | null;
  if (!body || typeof body !== "object") return fail("Send { logins, via, note? }.");
  try {
    const via = body.via === "mention" ? "mention" : "share";
    return Response.json(await grantShare(id, { logins: body.logins as string[], via, note: typeof body.note === "string" ? body.note : undefined }));
  } catch (err) {
    return failed(err);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    return Response.json(await revokeShareGrant(id, Number(new URL(req.url).searchParams.get("github"))));
  } catch (err) {
    return failed(err);
  }
}
