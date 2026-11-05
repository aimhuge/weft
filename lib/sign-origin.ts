// sign.weft.zip: the one origin where a passkey is made and signs (docs/architecture/mobile-security.md, "Passkey
// approvals"). It serves only two static pages (public/sign/pair.html, approve.html) and their script, built from
// sign/main.ts, under a strict CSP with no inline script; every other path on that host is a 404, and those files are a
// 404 on every other host. So a script injected anywhere on weft.zip can't reach the pairing secret, make the passkey
// or drive the sheet: WebAuthn binds the passkey to sign.weft.zip, and the Mac only takes that origin.
// Pure, so proxy.ts routes with it and the tests check every case.
import { SUPABASE_URL } from "./supabase-project";

export const SIGN_HOST = "sign.weft.zip";
export const SIGN_ORIGIN = `https://${SIGN_HOST}`;
export const SIGN_PAIR_URL = `${SIGN_ORIGIN}/pair`;

// What each public path on the sign host is, in public/sign/.
const PAGES: Record<string, string> = {
  "/pair": "/sign/pair.html",
  "/approve": "/sign/approve.html",
  "/app.js": "/sign/app.js",
  "/app.css": "/sign/app.css",
};

// The sign host, and in development one more (WEFT_SIGN_HOST, e.g. sign.localhost), never in production.
export function signHosts(env: { NODE_ENV?: string; WEFT_SIGN_HOST?: string }): string[] {
  return env.WEFT_SIGN_HOST && env.NODE_ENV !== "production" ? [SIGN_HOST, env.WEFT_SIGN_HOST] : [SIGN_HOST];
}

// Lowercased, without the port or a trailing dot (sign.weft.zip. is the same host to DNS and to a browser).
const hostname = (host: string | null) => (host ?? "").toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");

export type SignRoute = { rewrite: string } | { notFound: true } | null;

// Where a request goes: on the sign host, one of its pages or a 404; elsewhere, a 404 for the sign files and null
// (carry on as usual) for anything else.
export function signRoute(host: string | null, pathname: string, hosts: readonly string[]): SignRoute {
  if (hosts.includes(hostname(host))) {
    const page = PAGES[pathname];
    return page ? { rewrite: page } : { notFound: true };
  }
  return pathname === "/sign" || pathname.startsWith("/sign/") ? { notFound: true } : null;
}

// No inline script or style, nothing loaded from anywhere but this host, connections to Supabase only (sign-in,
// the pending ask, the answer), no plugins, no <base>, no framing, no form posts.
export function signCsp(supabaseUrl = SUPABASE_URL): string {
  const supabase = new URL(supabaseUrl).origin;
  return [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self'",
    "img-src 'self' data:",
    `connect-src ${supabase} ${supabase.replace(/^https:/, "wss:")}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join("; ");
}

// Headers every sign-host response carries besides the CSP: never framed, never sniffed, no referrer.
export const SIGN_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
};

// The page the weft.zip board opens (a new top-level tab, never a frame) to approve one waiting ask: only its ids.
export function signApproveUrl(origin: string, cardId: string, pendingId: string): string {
  return `${origin}/approve?${new URLSearchParams({ card: cardId, pending: pendingId }).toString()}`;
}
