// The weft.zip OAuth round-trip landing point. GET /auth/callback?code&next
// exchanges the one-time `code` against the PKCE verifier kept in the cookie
// session, bumps profiles.last_login_at / login_count through the service
// client, and 303s to `next`.
//
// Failures land on /login?error=link&reason=… so the form can show "the link
// expired" the same way it does for the desktop's /api/auth/callback.
//
// Only on the deployed site: a 404 in `next dev` keeps the desktop's loopback
// callback path (lib/auth/server.ts `createAuthCallback`) the only one in
// the tree.
import { after } from "next/server";
import {
  finishWebSignIn,
  webAuthFailureUrl,
  webCallbackOrigin,
  webCanonicalRedirect,
  webClient,
  webRequestOrigin,
} from "@/lib/web-auth";
import { openSourceAfterSignIn } from "@/lib/billing/oss-grant";
import { isWebEnabled } from "@/lib/home";

const DEFAULT_NEXT = "/team";

export async function GET(request: Request): Promise<Response> {
  if (!isWebEnabled()) return new Response("Not Found", { status: 404 });
  // The host the browser actually used, not `request.url`'s host — `next dev`
  // normalizes the URL to localhost, but the cookies are keyed on the Host header.
  const requestOrigin = webRequestOrigin(request);
  // The verifier cookie is host-only, so a callback that arrives on the other loopback
  // name has nothing to exchange against. Move it to the canonical host, keeping the
  // one-time code in the query string.
  const canonical = webCanonicalRedirect(requestOrigin, request.url);
  if (canonical) return Response.redirect(canonical, 303);
  const url = new URL(request.url);
  // One origin for both the success and the failure redirect, so they cannot disagree.
  const origin = webCallbackOrigin(requestOrigin);
  const result = await finishWebSignIn(await webClient(), {
    request,
    origin,
    code: url.searchParams.get("code"),
    providerError: url.searchParams.get("error"),
    next: url.searchParams.get("next") ?? DEFAULT_NEXT,
    defaultNext: DEFAULT_NEXT,
  });
  if (result.kind === "error") {
    return Response.redirect(webAuthFailureUrl(origin, result.reason), 303);
  }
  // The Open Source check reads GitHub, so it runs after the redirect rather than holding up sign-in.
  const github = result.github;
  if (github) after(() => openSourceAfterSignIn(github));
  return Response.redirect(result.url, 303);
}
