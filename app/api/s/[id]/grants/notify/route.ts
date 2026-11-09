// POST /api/s/[id]/grants/notify — weft.zip tells a person their GitHub account was named on a card's share
// (lib/share-grant-notify.ts). The owner's Mac calls it with its own access token right after adding the grant
// (lib/card-share-grants.ts); answers { notice: "emailed" | "no-email" | "not-sent" }.
import { connection } from "next/server";
import { notifyGrant, githubPublicEmail, resendSender } from "@/lib/share-grant-notify";
import { SITE } from "@/lib/site";
import { bearerUser, serviceClient } from "@/lib/web-session";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const user = await bearerUser(req);
  if (!user) return Response.json({ error: "signed-out" }, { status: 401 });
  const service = serviceClient();
  if (!service) return Response.json({ notice: "not-sent" });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as unknown;
  const origin = process.env.VERCEL ? SITE : new URL(req.url).origin;
  const { status, json } = await notifyGrant({ service, send: resendSender(), publicEmail: githubPublicEmail(), origin }, user.id, id, body);
  return Response.json(json, { status });
}
