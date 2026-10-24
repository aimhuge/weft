// Server-side auth helpers. Mirror `@aimhuge/auth/server` so we can swap to the
// package when the upstream tag ships. On the desktop / `next dev` they read
// the file-based PKCE session in `~/.weft/account.json` (0600); on the deployed
// weft.zip they read the per-visitor cookie session (lib/web-session.ts), so
// each web visitor is a real account.
import { accountClient, accountView, finishSignIn, signOut, toAccountUser } from "../account";
import { isWebEnabled } from "../home";
import { readWebSessionIdentity } from "../web-auth";
import { safeNextPath } from "./next-path";
import { identityFromUser, type SessionIdentity } from "./identity";

export { safeNextPath };
export type { SessionIdentity };

/**
 * The "/auth/callback" landing point. Exchanges the one-time `code` for a session
 * (the PKCE verifier is in the file-based session), then on to `next`.
 *
 * On failure (provider error on the URL, no code, exchange failed) the user lands
 * on `/login?error=link&reason=…` so the form can show "the link expired".
 */
export function createAuthCallback({ defaultNext, loginPath = "/login" }: { defaultNext: string; loginPath?: string }) {
  return async function GET(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const next = safeNextPath(url.searchParams.get("next"), defaultNext);
    const origin = url.origin;

    const fail = (reason: string) => {
      const dest = new URL(loginPath, origin);
      dest.searchParams.set("error", "link");
      dest.searchParams.set("reason", reason);
      return Response.redirect(dest, 303);
    };

    const providerError = url.searchParams.get("error");
    if (providerError) return fail("provider");

    const code = url.searchParams.get("code");
    if (!code) return fail("nocode");

    try {
      await finishSignIn(code);
    } catch (err) {
      console.error("[auth/callback] exchangeCodeForSession failed:", err);
      return fail("exchange");
    }
    return Response.redirect(new URL(next, origin), 303);
  };
}

/** Read the signed-in identity for the "already signed in" banner on `/login`. */
export async function readSessionIdentity(): Promise<SessionIdentity | null> {
  if (isWebEnabled()) {
    // The deployed site reads the per-visitor cookie session (lib/web-session.ts);
    // accountClient is the desktop's file-based PKCE session and isn't set up for
    // a web visitor.
    const web = await readWebSessionIdentity();
    if (!web) return null;
    return { name: web.name, email: web.email, avatarUrl: web.avatar };
  }
  try {
    const supabase = accountClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user ? identityFromUser(user) : null;
  } catch {
    return null;
  }
}

/** Polled by the board to know who's signed in (lib/use-account.ts). */
export async function accountState() {
  return accountView();
}

/** Server-side sign-out, for the `/api/account/signout` action. */
export async function signOutAction() {
  await signOut();
  const {
    data: { user },
  } = await accountClient().auth.getUser();
  return user ? toAccountUser(user) : null;
}
