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
//   3. The callback exchanges the code with oauth.v2.access and gets back the webhook URL.
//
// PKCE (lib/slack-pkce.ts): the app is a public client, so the exchange sends a `code_verifier` instead of the
// Client Secret. The secret is one less thing to copy by hand, and one less credential to leak — but Slack
// accepts only S256.

import { challengeOf, makeState, type PkceState } from "./slack-pkce";

export const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
export const SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access";
export const CALLBACK_PATH = "/api/slack/oauth/callback";

// The scope that asks Slack for the channel picker. It is a bot scope: Slack supports `incoming-webhook` for
// bot and legacy-bot tokens only, and rejects it under oauth_config.scopes.user with `illegal_user_scopes`.
export const INCOMING_WEBHOOK_SCOPE = "incoming-webhook";

export interface SlackOAuthConfig {
  clientId: string;
  /** The app's Client Secret. Unused when PKCE is on, and absent is fine then. */
  clientSecret?: string;
  redirectUri: string;
}

/**
 * The URL the user opens to install the app and pick the feedback channel.
 *
 * With a PKCE state, the challenge goes out alongside it: the challenge is the hash of the verifier, and the
 * verifier comes back in the state, so the callback can finish the exchange.
 */
export function authorizeUrl(config: SlackOAuthConfig, state?: string, verifier?: string): string {
  const url = new URL(SLACK_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("scope", INCOMING_WEBHOOK_SCOPE);
  url.searchParams.set("redirect_uri", config.redirectUri);
  if (state) url.searchParams.set("state", state);
  if (verifier) {
    url.searchParams.set("code_challenge", challengeOf(verifier));
    url.searchParams.set("code_challenge_method", "S256");
  }
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
 * With PKCE on (the app's manifest says `pkce_enabled`), the body carries a `code_verifier` and no
 * `client_secret` — the secret never leaves the console page. Without it, the secret is sent as a form field
 * (never a query string, so it doesn't end up in a server log).
 */
export async function exchangeCode(
  config: SlackOAuthConfig,
  code: string,
  fetcher: typeof fetch = fetch,
  verifier?: string,
): Promise<{ url: string; channel: string | null } | null> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    code,
    redirect_uri: config.redirectUri,
  });
  if (verifier) {
    body.set("code_verifier", verifier);
  } else if (config.clientSecret) {
    body.set("client_secret", config.clientSecret);
  }
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

/** The OAuth config from the environment; null when the app's client id isn't set. */
export function configFromEnv(env: Record<string, string | undefined> = process.env): SlackOAuthConfig | null {
  const clientId = env.SLACK_CLIENT_ID?.trim();
  if (!clientId) return null;
  const clientSecret = env.SLACK_CLIENT_SECRET?.trim();
  return {
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
    redirectUri: env.SLACK_REDIRECT_URI?.trim() || `https://weft.zip${CALLBACK_PATH}`,
  };
}

export { makeState, challengeOf };
export type { PkceState };
