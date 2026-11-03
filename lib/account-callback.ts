// The custom URL scheme the desktop app registers as the OAuth redirect target, so the URL is
// stable across dev server port changes (the port is picked at random on every Weft restart).
// In packaged builds the OS hands weft://account-callback back to Electron's main process, which
// forwards the code to /api/auth/weft-callback. In plain `next dev` (no Electron) the scheme
// is not registered, so we fall back to the HTTP loopback.
// Its own module, with no Node imports, because client code (lib/auth/desktop.ts) needs it and
// lib/account.ts reads files: importing that from the browser bundle breaks Turbopack.
export const WEEFT_PROTOCOL = "weft";
export const ACCOUNT_CALLBACK_HOST = "account-callback";
export function weftCallbackUrl(): string {
  return `${WEEFT_PROTOCOL}://${ACCOUNT_CALLBACK_HOST}`;
}

// Where Supabase sends the browser after the desktop sign-in: a weft.zip page that hands the code on
// to weft://account-callback (app/auth/desktop/route.ts). Redirecting straight to weft:// fails when
// the browser never saw a click (GitHub approving an app it already knows): Chrome and Edge drop an
// external-app launch with no user gesture behind it and leave the tab on Supabase's /callback.
export const DESKTOP_RETURN_PATH = "/auth/desktop";
export function desktopReturnUrl(site = process.env.NEXT_PUBLIC_SITE_URL || "https://weft.zip"): string {
  return `${site.replace(/\/+$/, "")}${DESKTOP_RETURN_PATH}`;
}
