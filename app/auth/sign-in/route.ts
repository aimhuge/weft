// The weft.zip sign-in entry. GET /auth/sign-in?provider=github|google&next=/path
// starts an OAuth round trip with a per-visitor cookie session (lib/web-session.ts);
// the browser is sent to the provider, the provider comes back to /auth/callback,
// and /auth/callback exchanges the code for a session and lands on `next`.
//
// Only on the deployed site: the desktop app signs in through the board's
// AccountButton (lib/account.ts), not this URL. A 404 in `next dev` keeps the
// route out of the way for the desktop's localhost loopback.
import {
  startWebSignIn,
  webCallbackOrigin,
  webCanonicalRedirect,
  webClient,
  webRequestOrigin,
  webSignInErrorUrl,
} from "@/lib/web-auth";
import { isWebEnabled } from "@/lib/home";

const DEFAULT_NEXT = "/team";

export async function GET(request: Request): Promise<Response> {
  if (!isWebEnabled()) return new Response("Not Found", { status: 404 });
  // The host the browser actually used, not `request.url`'s host — `next dev`
  // normalizes the URL to localhost, but the cookies are keyed on the Host header.
  const requestOrigin = webRequestOrigin(request);
  // Move a visitor who reached the dev server on the other loopback name (localhost vs
  // 127.0.0.1) across to the canonical one first. The PKCE verifier cookie is host-only,
  // so the host that starts the round trip must be the host that finishes it.
  const canonical = webCanonicalRedirect(requestOrigin, request.url);
  if (canonical) return Response.redirect(canonical, 303);
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider") ?? "";
  const next = url.searchParams.get("next") ?? DEFAULT_NEXT;
  // The origin the callback lands on. Deployed, that's us; local, it's pinned so the
  // browser's choice of localhost vs 127.0.0.1 doesn't need two allow-list entries.
  const origin = webCallbackOrigin(requestOrigin);
  const result = await startWebSignIn(await webClient(), {
    provider,
    origin,
    next,
    defaultNext: DEFAULT_NEXT,
  });
  if (result.kind === "error") return Response.redirect(webSignInErrorUrl(origin, result.reason), 303);
  return Response.redirect(result.url, 303);
}
