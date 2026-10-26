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
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase-project";

export async function proxy(request: NextRequest) {
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
  // The weft.zip pages that read the session: sign-in, the workspace's team page, /billing (the pricing cards' way in) and invite links.
  // /s/:path* is included so a private share's redirect-to-login sees the visitor's cookie state.
  // The app-link matchers let the proxy decide on every request; non-matches still hit the function
  // but return NextResponse.next() at once (no session work for them).
  matcher: [
    "/login",
    "/app",
    "/team",
    "/billing",
    "/invite/:token*",
    "/:orgSlug/team/:path*",
    "/:orgSlug/billing/:path*",
    "/s/:path*",
    // /@<username>/apps/<slug> and /<org>/apps/<slug> rewrites (lib/app-routes.ts). The strings
    // are inlined here so Next's static parser can see them; a spread into appLinkMatchers()
    // makes `config` unparseable and the proxy throws on every request.
    "/@:username/apps/:slug",
    "/:org/apps/:slug",
  ],
};
