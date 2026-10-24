// The weft.zip sign-in entry. GET /auth/sign-in?provider=github|google&next=/path
// starts an OAuth round trip with a per-visitor cookie session (lib/web-session.ts);
// the browser is sent to the provider, the provider comes back to /auth/callback,
// and /auth/callback exchanges the code for a session and lands on `next`.
//
// Only on the deployed site: the desktop app signs in through the board's
// AccountButton (lib/account.ts), not this URL. A 404 in `next dev` keeps the
// route out of the way for the desktop's localhost loopback.
import { startWebSignIn, webCallbackOrigin, webClient, webSignInErrorUrl } from "@/lib/web-auth";
import { isWebEnabled } from "@/lib/home";

const DEFAULT_NEXT = "/team";

export async function GET(request: Request): Promise<Response> {
  if (!isWebEnabled()) return new Response("Not Found", { status: 404 });
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider") ?? "";
  const next = url.searchParams.get("next") ?? DEFAULT_NEXT;
  // The origin the callback lands on. Deployed, that's us; local, it's pinned so the
  // browser's choice of localhost vs 127.0.0.1 doesn't need two allow-list entries.
  const origin = webCallbackOrigin(url.origin);
  const result = await startWebSignIn(await webClient(), {
    provider,
    origin,
    next,
    defaultNext: DEFAULT_NEXT,
  });
  if (result.kind === "error") return Response.redirect(webSignInErrorUrl(origin, result.reason), 303);
  return Response.redirect(result.url, 303);
}
