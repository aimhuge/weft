// Refreshes the weft.zip visitor's Supabase session cookie before the team pages render (lib/web-session.ts):
// Server Components can read cookies but not write them, so an expired access token is swapped here. Only on the
// deployed Weft, or on a local server with WEFT_WEB=1; the desktop board's routes never match, and a local Weft
// without WEFT_WEB passes straight through.
//
// Also rewrites the public app links /@<username>/apps/<slug> and /<org>/apps/<slug> to the
// route folders that serve them (/u/.../apps/... and /w/.../apps/...; lib/app-routes.ts). The gate
// for these pages reads the visitor's session, so the rewrite is paired with the session refresh
// and returns one NextResponse.rewrite with the refreshed cookies. A path that isn't an app link
// returns NextResponse.next() at once, so the reserved-first-segment check costs nothing for
// every other request.
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { appLinkTarget } from "@/lib/app-routes";
import { isWebEnabled } from "@/lib/home";
import { SIGN_HEADERS, signCsp, signHosts, signRoute } from "@/lib/sign-origin";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase-project";

// sign.weft.zip serves only its passkey pages, under their own CSP; their files are a 404 on every other host
// (lib/sign-origin.ts). Decided before anything else, and with no session work: that host has no cookies of weft.zip's.
function signResponse(request: NextRequest): NextResponse | null {
  const route = signRoute(request.headers.get("host"), request.nextUrl.pathname, signHosts(process.env));
  if (!route) return null;
  const response = "rewrite" in route ? NextResponse.rewrite(new URL(route.rewrite, request.url)) : new NextResponse("Not found", { status: 404 });
  response.headers.set("Content-Security-Policy", signCsp());
  for (const [key, value] of Object.entries(SIGN_HEADERS)) response.headers.set(key, value);
  return response;
}

export async function proxy(request: NextRequest) {
  const signed = signResponse(request);
  if (signed) return signed;
  // isWebEnabled(), not isDeployed(): WEFT_WEB=1 turns the weft.zip routes on for a local
  // server too, and those routes read the cookie session. Gating the refresh on the
  // deployed-only check would let a local visitor's expired access token bounce them
  // back to "signed out" on the very pages that need the session.
  if (!isWebEnabled() || !SUPABASE_KEY) return NextResponse.next();
  // The app-link rewrite is the only path that needs a session refresh. If the request isn't an
  // app link, return at once with no Supabase work.
  const target = appLinkTarget(request.nextUrl.pathname);
  if (target) {
    let response = NextResponse.rewrite(new URL(target, request.url), { request });
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const c of list) request.cookies.set(c.name, c.value);
          response = NextResponse.rewrite(new URL(target, request.url), { request });
          for (const c of list) response.cookies.set(c.name, c.value, c.options);
        },
      },
    });
    // getClaims refreshes an expired token through setAll; nothing between createServerClient and it.
    await supabase.auth.getClaims();
    return response;
  }
  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const c of list) request.cookies.set(c.name, c.value);
        response = NextResponse.next({ request });
        for (const c of list) response.cookies.set(c.name, c.value, c.options);
      },
    },
  });
  // getClaims refreshes an expired token through setAll; nothing between createServerClient and it.
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  // The weft.zip pages that read the session: sign-in, the workspace's team page and board, /billing (the pricing cards' way in) and invite links.
  // /s/:path* is included so a private share's redirect-to-login sees the visitor's cookie state.
  // The app-link matchers let the proxy decide on every request; non-matches still hit the function
  // but return NextResponse.next() at once (no session work for them).
  matcher: [
    "/login",
    "/app",
    "/team",
    "/billing",
    "/invite/:token*",
    "/pair",
    "/:orgSlug/team/:path*",
    "/:orgSlug/billing/:path*",
    // The web board renders through requireTeam and webClient() like the team page, so its cookie is refreshed here too.
    "/:orgSlug/board/:path*",
    "/s/:path*",
    // A tunnel's address reads the visitor's session the same way (lib/tunnel-address.ts).
    "/t/:path*",
    // /@<username>/apps/<slug> and /<org>/apps/<slug> rewrites (lib/app-routes.ts). The strings
    // are inlined here so Next's static parser can see them; a spread into appLinkMatchers()
    // makes `config` unparseable and the proxy throws on every request.
    "/@:username/apps/:slug",
    "/:org/apps/:slug",
    // sign.weft.zip (and its dev host): every path, so anything but its pages is a 404 (lib/sign-origin.ts). And its
    // files under /sign, refused on every other host.
    // Next anchors a host value as a regex (^…$), so the dots are escaped; a trailing dot is the same host.
    { source: "/:path*", has: [{ type: "host", value: "sign\\.weft\\.zip\\.?" }] },
    { source: "/:path*", has: [{ type: "host", value: "sign\\.localhost\\.?" }] },
    "/sign/:path*",
    "/@:username/threads/:slug",
  ],
};
