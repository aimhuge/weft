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
import { finishWebSignIn, webAuthFailureUrl, webCallbackOrigin, webClient } from "@/lib/web-auth";
import { openSourceAfterSignIn } from "@/lib/billing/oss-grant";
import { isWebEnabled } from "@/lib/home";

const DEFAULT_NEXT = "/team";

export async function GET(request: Request): Promise<Response> {
  if (!isWebEnabled()) return new Response("Not Found", { status: 404 });
  const url = new URL(request.url);
  const result = await finishWebSignIn(await webClient(), {
    request,
    code: url.searchParams.get("code"),
    providerError: url.searchParams.get("error"),
    next: url.searchParams.get("next") ?? DEFAULT_NEXT,
    defaultNext: DEFAULT_NEXT,
  });
  // Same origin the sign-in route pinned, so a bounce back to /login lands on a host
  // the browser already trusts.
  if (result.kind === "error") {
    return Response.redirect(webAuthFailureUrl(webCallbackOrigin(url.origin), result.reason), 303);
  }
  // The Open Source check reads GitHub, so it runs after the redirect rather than holding up sign-in.
  const github = result.github;
  if (github) after(() => openSourceAfterSignIn(github));
  return Response.redirect(result.url, 303);
}
