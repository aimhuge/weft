// The Weft phone app's TestFlight on weft.zip (docs/architecture/mobile.md#testflight). GET is public: the group's
// public link for the QR code, and whether this deployment can email invites. POST emails the signed-in person an
// invite, with the address from their Supabase session (Authorization: Bearer <jwt>, the desktop's access token),
// never from the body, so nobody can sign someone else up.
//
// No localhost guard: like /api/teams, this is the deployed site's API and the bearer token is the check.
import { connection } from "next/server";
import { SUPABASE_KEY } from "@/lib/supabase-project";
import { inviteTester, testflightConfig, testflightPublicUrl } from "@/lib/testflight";
import type { TestflightInfo } from "@/lib/testflight-types";
import { bearerUser } from "@/lib/web-session";

export async function GET() {
  await connection();
  const info: TestflightInfo = { url: testflightPublicUrl(), invites: Boolean(SUPABASE_KEY && testflightConfig()) };
  return Response.json(info);
}

export async function POST(req: Request) {
  await connection();
  const cfg = testflightConfig();
  if (!SUPABASE_KEY || !cfg) return Response.json({ ok: false, error: "TestFlight invites aren't set up on this Weft." }, { status: 503 });
  const user = await bearerUser(req);
  if (!user) return Response.json({ ok: false, error: "Sign in to your Weft account first." }, { status: 401 });
  if (!user.email) return Response.json({ ok: false, error: "Your Weft account has no email address to invite." }, { status: 400 });
  const answer = await inviteTester(cfg, { email: user.email, name: user.name });
  return Response.json(answer, { status: answer.ok ? 200 : 502 });
}
