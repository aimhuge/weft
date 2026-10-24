// The weft.zip sign-out entry. POST /auth/sign-out signs the visitor out of
// this device only (scope: "local" — a sign-in on another tab / phone
// survives) and 303s to /login. A form submission from the /login banner
// hits this route; a plain GET would let any link trigger a sign-out, so
// the route only accepts POST.
//
// Only on the deployed site: a 404 in `next dev` keeps the desktop's
// /api/account/signout (lib/account.ts `signOut`) the only one in the tree.
import { webCallbackOrigin, webClient, webRequestOrigin, webSignOut } from "@/lib/web-auth";
import { isWebEnabled } from "@/lib/home";

export async function POST(request: Request): Promise<Response> {
  if (!isWebEnabled()) return new Response("Not Found", { status: 404 });
  // Sign-out clears the host-only cookies, so it lands on the host that holds them.
  // The Host header is that host; `request.url`'s host is normalized to localhost.
  const origin = webCallbackOrigin(webRequestOrigin(request));
  const result = await webSignOut(await webClient(), { request, loginPath: "/login", origin });
  return Response.redirect(result.url, 303);
}
