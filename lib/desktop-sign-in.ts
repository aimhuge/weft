// The desktop app's last step of a Weft account sign-in, whichever way the OAuth query got back:
// Electron main's weft://account-callback POST (app/api/auth/weft-callback) on macOS, or the system
// browser landing on the loopback /api/auth/callback on Windows and Linux (lib/account.ts redirectUrl).
// Exchanges the code against the PKCE verifier and renders the result page (lib/account-page.ts),
// which electron/account-link.cjs reads its error dialog from.
import { finishSignIn } from "./account";
import { accountPage } from "./account-page";

export async function finishDesktopSignIn(params: Record<string, string | undefined>): Promise<Response> {
  const failed = params.error_description || params.error;
  if (failed) return accountPage("Couldn't sign in to Weft", failed, false);
  try {
    const user = await finishSignIn(params.code ?? "");
    const who = user.email ?? user.name;
    return accountPage("Signed in to Weft", `${who ? `You're signed in as ${who}. ` : ""}You can close this tab and go back to Weft.`, true);
  } catch (err) {
    return accountPage("Couldn't sign in to Weft", err instanceof Error ? err.message : String(err), false);
  }
}
