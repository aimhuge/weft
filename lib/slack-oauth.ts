// The Slack OAuth install that produces the feedback channel's incoming webhook URL
// (app/api/slack/oauth/callback, lib/feedback-send.ts).
//
// Slack has no Web API method for incoming webhooks — no create, no list, no delete. The only programmatic
// route to the address is an install: the app asks for the `incoming-webhook` scope, Slack shows the user a
// channel picker, and the install's answer carries `incoming_webhook.url`. That answer is a credential, so it
// goes straight into the database (public.slack_webhooks) and never into a log, a transcript or a deploy.
//
// The flow, in three steps:
//   1. The user is sent to https://slack.com/oauth/v2/authorize?client_id=…&scope=incoming-webhook&redirect_uri=…
//   2. Slack redirects to the callback with `code` (and `state`).
//   3. The callback exchanges the code with oauth.v2.access — which needs the app's Client ID and Client Secret —
//      and gets back the webhook URL.

export const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
export const SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access";
export const CALLBACK_PATH = "/api/slack/oauth/callback";

// The scope that asks Slack for the channel picker. It is a bot scope: Slack supports `incoming-webhook` for
// bot and legacy-bot tokens only, and rejects it under oauth_config.scopes.user with `illegal_user_scopes`.
export const INCOMING_WEBHOOK_SCOPE = "incoming-webhook";

export interface SlackOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** The URL the user opens to install the app and pick the feedback channel. */
export function authorizeUrl(config: SlackOAuthConfig, state?: string): string {
  const url = new URL(SLACK_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("scope", INCOMING_WEBHOOK_SCOPE);
  url.searchParams.set("redirect_uri", config.redirectUri);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

interface TokenAnswer {
  ok?: boolean;
  error?: string;
  incoming_webhook?: { url?: string; channel?: string; channel_id?: string };
}

/** The webhook URL and its channel, out of an oauth.v2.access answer. Null when Slack said no. */
export function webhookFromAnswer(answer: unknown): { url: string; channel: string | null } | null {
  if (!answer || typeof answer !== "object") return null;
  const body = answer as TokenAnswer;
  if (body.ok === false) return null;
  const url = body.incoming_webhook?.url;
  if (typeof url !== "string" || !url.startsWith("https://hooks.slack.com/")) return null;
  const channel = body.incoming_webhook?.channel;
  return { url, channel: typeof channel === "string" && channel ? channel : null };
}

/**
 * Trades the install's code for the app's tokens. The answer carries the webhook URL.
 *
 * `client_id` and `client_secret` come from the app's console page (OAuth & Permissions → Basic Information).
 * The secret is sent as a form field, never as a query string, so it doesn't end up in a server log.
 */
export async function exchangeCode(
  config: SlackOAuthConfig,
  code: string,
  fetcher: typeof fetch = fetch,
): Promise<{ url: string; channel: string | null } | null> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
  });
  let answer: TokenAnswer;
  try {
    const res = await fetcher(SLACK_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    answer = (await res.json()) as TokenAnswer;
  } catch {
    return null;
  }
  return webhookFromAnswer(answer);
}

/** The OAuth config from the environment; null when the app's credentials aren't set. */
export function configFromEnv(env: Record<string, string | undefined> = process.env): SlackOAuthConfig | null {
  const clientId = env.SLACK_CLIENT_ID?.trim();
  const clientSecret = env.SLACK_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: env.SLACK_REDIRECT_URI?.trim() || `https://weft.zip${CALLBACK_PATH}` };
}
