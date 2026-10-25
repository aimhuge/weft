import { authorizeUrl, configFromEnv } from "@/lib/slack-oauth";
import { makeState, stateSecret } from "@/lib/slack-pkce";

// The Slack OAuth install, started here (lib/slack-oauth.ts). The user opens this, Slack shows the
// `incoming-webhook` channel picker, and their choice comes back to the callback, which exchanges the code
// for the webhook's address.
//
// The channel picker is the point: the app asks for the `incoming-webhook` scope, and only an install through
// the OAuth page creates the webhook. The CLI's `apps.developerInstall` shortcut skips the picker, which is
// why it never yields a URL.
//
// Nothing is secret in the URL this builds — the app's public client id, the scope, and a PKCE challenge
// (a hash, not the verifier) — so it can be a plain link.

export function GET() {
  const config = configFromEnv();
  if (!config) {
    return Response.json(
      { error: "This app's Slack client id is missing. Set SLACK_CLIENT_ID on the deployment." },
      { status: 503 },
    );
  }
  // The state carries the verifier (signed), so the callback can finish the exchange without a store.
  const state = makeState(stateSecret());
  return Response.redirect(authorizeUrl(config, state.value, state.verifier), 302);
}
