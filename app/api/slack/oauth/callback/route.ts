import { configFromEnv, exchangeCode } from "@/lib/slack-oauth";
import { readState, stateSecret } from "@/lib/slack-pkce";
import { saveWebhook } from "@/lib/slack-webhook-store";

// Slack's OAuth install, landing here (lib/slack-oauth.ts). The app asks for the `incoming-webhook` scope,
// Slack shows the user a channel picker, and redirects back with a code. We exchange it for the app's tokens,
// whose answer carries `incoming_webhook.url` — the address of the channel's incoming webhook.
//
// That URL is a credential (anyone holding it can post to the channel), so it goes straight into the database
// and nowhere else: not in a log, not in this page's HTML, not in a redirect URL. The answer here says only
// whether it worked.
//
// No `guard()`: Slack's redirect arrives from the internet, not from the desktop app, and the desktop app's
// launch token means nothing to Slack. The code itself is the credential that matters — it is single-use and
// short-lived, and it is spent the moment this handler exchanges it.
//
// The exchange is PKCE (lib/slack-pkce.ts): the state carries the verifier, signed, and the app's Client
// Secret never leaves the console page.

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Weft feedback</title>
<style>body{font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#0f1014;color:#e9eaf0}
main{max-width:34rem;padding:32px;text-align:center}h1{font-size:20px;margin:0 0 10px}p{color:#9aa0b0;margin:0}</style></head>
<body><main><h1>%TITLE%</h1><p>%BODY%</p></main></body></html>`;

function page(title: string, body: string): Response {
  return new Response(PAGE.replace("%TITLE%", title).replace("%BODY%", body), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  if (error) return page("Slack declined", `The install was not approved (${error}). Nothing was changed.`);

  const code = url.searchParams.get("code")?.trim();
  if (!code) return page("Nothing to do", "This link has no install code in it.");

  const config = configFromEnv();
  if (!config) {
    return page(
      "Not set up yet",
      "This app's Slack client id is missing, so the install code could not be exchanged. Set SLACK_CLIENT_ID and try again.",
    );
  }

  // The verifier rides in the state; without a valid one the exchange would fail anyway, so say so plainly.
  const state = readState(url.searchParams.get("state"), stateSecret());
  if (!state.ok) {
    return page("That install expired", "The install link is more than 15 minutes old, or its state was altered. Start the install again.");
  }

  const webhook = await exchangeCode(config, code, fetch, state.verifier);
  if (!webhook) {
    return page("That didn't work", "Slack would not hand over the webhook address. The code may have expired — try the install again.");
  }

  const saved = await saveWebhook("feedback", webhook.url, webhook.channel);
  if (!saved) {
    return page("Saved nowhere", "The webhook address arrived, but it could not be stored. Check the database and the service key.");
  }

  return page("Feedback is wired up", "The webhook address is stored. Feedback sent from any Weft board now lands in that channel.");
}
