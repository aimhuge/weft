// GET /api/connectors/github/start, on weft.zip: the start of connecting GitHub, opened in the browser pane from Settings
// → Devices. Needs you signed in on weft.zip (else it sends you to /login and back here); then a state and a PKCE
// verifier go in a short httpOnly cookie for this browser, and you go to GitHub's consent page for the Weft app
// (lib/connector-connect.ts).
import { cookies } from "next/headers";
import { connection } from "next/server";
import { CONNECT_COOKIE, CONNECT_MAX_AGE, CONNECT_PATH, callbackUrl, donePage, newConnect } from "@/lib/connector-connect";
import { connectorDeps } from "@/lib/connector-deps";
import { authorizeUrl } from "@/lib/github-app";
import { webRequestOrigin } from "@/lib/web-auth";
import { webUser } from "@/lib/web-session";

export async function GET(req: Request) {
  await connection();
  const deps = connectorDeps();
  if (!deps) return donePage("Not set up yet", "GitHub connectors aren't set up on this server yet.");
  const origin = webRequestOrigin(req);
  const user = await webUser();
  if (!user) return Response.redirect(`${origin}/login?next=${encodeURIComponent(`${CONNECT_PATH}/start`)}`, 303);
  const flow = newConnect(user.id);
  (await cookies()).set(CONNECT_COOKIE, flow.cookie, { httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax", path: CONNECT_PATH, maxAge: CONNECT_MAX_AGE });
  return Response.redirect(authorizeUrl(deps.cfg, { redirectUri: callbackUrl(origin), state: flow.state, challenge: flow.challenge }), 303);
}
