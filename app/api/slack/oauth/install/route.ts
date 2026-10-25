import { authorizeUrl, configFromEnv } from "@/lib/slack-oauth";

// The Slack OAuth install, started here (lib/slack-oauth.ts). The user opens this, Slack shows the
// `incoming-webhook` channel picker, and their choice comes back to the callback, which exchanges the code
// for the webhook's address.
//
// The channel picker is the point: the app asks for the `incoming-webhook` scope, and only an install through
// the OAuth page creates the webhook. The CLI's `apps.developerInstall` shortcut skips the picker, which is
// why it never yields a URL.
//
// Nothing is secret in the URL this builds — just the app's public client id and the scope — so it can be a
// plain link.

export function GET() {
  const config = configFromEnv();
  if (!config) {
    return Response.json(
      { error: "This app's Slack credentials are missing. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET on the deployment." },
      { status: 503 },
    );
  }
  return Response.redirect(authorizeUrl(config), 302);
}
