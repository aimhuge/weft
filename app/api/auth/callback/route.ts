// The /api/auth/callback landing point. Mirrors `@aimhuge/auth/server`'s
// `createAuthCallback` so the local seam is wire-compatible with the package.
// When the upstream tag lands, this file is replaced by:
//
//   export const GET = createAuthCallback({ defaultNext: "/app" });
//
// Today the body is the same: exchange the one-time `code` against the PKCE
// verifier kept in the file-based session (lib/account.ts:finishSignIn), then
// redirect to `next`. Failures land on `/login?error=link&reason=…` so the form
// can show a "the link expired" message.
//
// Inside the desktop app this is where the system browser comes back on Windows
// and Linux (lib/account.ts redirectUrl). That browser has no token for the board,
// so it gets the "Signed in to Weft" page instead of a redirect; the board sees the
// new session by polling.
import { createAuthCallback } from "@/lib/auth";
import { finishDesktopSignIn } from "@/lib/desktop-sign-in";

const callback = createAuthCallback({ defaultNext: "/app" });

export function GET(request: Request): Promise<Response> {
  if (process.env.WEFT_SHELL_URL) return finishDesktopSignIn(Object.fromEntries(new URL(request.url).searchParams));
  return callback(request);
}
