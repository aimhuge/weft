// GET /auth/desktop?code=… — where Supabase lands the desktop app's Weft account sign-in. Hands the
// code on to weft://account-callback (lib/desktop-return.ts): at once, and from an "Open Weft"
// button for browsers that only launch an external app on a click. Served on every host, since the
// page only links back into the app; the code is useless without the app's PKCE verifier.
import { desktopReturnPage } from "@/lib/desktop-return";

export function GET(request: Request): Response {
  return desktopReturnPage(request.url);
}
