// /api/connectors/github/start, on weft.zip: the start of connecting GitHub, opened in the browser pane from Settings →
// Devices. GET needs you signed in on weft.zip (else it sends you to /login and back here) and shows one button; its
// POST, from this origin only (Sec-Fetch-Site), ends any earlier connection at GitHub, puts a state and a PKCE
// verifier in a short MACed httpOnly cookie for this browser, and sends you to GitHub's consent page for the Weft app
// (lib/connector-connect.ts).
import { cookies } from "next/headers";
import { connection } from "next/server";
import { CONNECT_MAX_AGE, callbackUrl, connectCookie, donePage, endPrevious, newConnect, sameOrigin, startPage, CONNECT_PATH } from "@/lib/connector-connect";
import { connectorDeps } from "@/lib/connector-deps";
import { authorizeUrl } from "@/lib/github-app";
import { webRequestOrigin } from "@/lib/web-auth";
import { webUser } from "@/lib/web-session";

const NOT_SET_UP = () => donePage("Not set up yet", "GitHub connectors aren't set up on this server yet.");

export async function GET(req: Request) {
  await connection();
  const deps = connectorDeps();
  if (!deps) return NOT_SET_UP();
  const origin = webRequestOrigin(req);
  const user = await webUser();
  if (!user) return Response.redirect(`${origin}/login?next=${encodeURIComponent(`${CONNECT_PATH}/start`)}`, 303);
  const row = await deps.db.tokens(user.id).catch(() => null);
  return startPage(row && !row.disconnect_pending_at ? row.github_login : null);
}

export async function POST(req: Request) {
  await connection();
  const deps = connectorDeps();
  if (!deps) return NOT_SET_UP();
  const origin = webRequestOrigin(req);
  if (!sameOrigin(req, origin)) return donePage("Not started", "Start connecting GitHub from Weft → Settings → Devices.");
  const user = await webUser();
  if (!user) return Response.redirect(`${origin}/login?next=${encodeURIComponent(`${CONNECT_PATH}/start`)}`, 303);
  let previous: number | null;
  try {
    previous = await endPrevious(deps, user.id);
  } catch (err) {
    return donePage("Not started", (err as Error).message);
  }
  const flow = newConnect(user.id, deps.key, previous);
  const secure = origin.startsWith("https:");
  (await cookies()).set(connectCookie(secure), flow.cookie, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: CONNECT_MAX_AGE });
  return Response.redirect(authorizeUrl(deps.cfg, { redirectUri: callbackUrl(origin), state: flow.state, challenge: flow.challenge }), 303);
}
