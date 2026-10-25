// The team's Slack incoming webhook, kept in the database (public.slack_webhooks) instead of a Vercel
// environment variable.
//
// The webhook's URL is a credential: anyone holding it can post to the channel. Slack shows it exactly once, at
// creation, in a console page — which is why it was so easy to lose and so hard to copy without it ending up in
// a transcript. The OAuth install (lib/slack-oauth.ts) hands it over programmatically instead, and this is
// where it lands: the service role writes it, the collector reads it, and nothing else can see it.
//
// docs/architecture/feedback.md.

import { serviceClient } from "./web-session";

export const FEEDBACK_PURPOSE = "feedback";

// Writes the webhook for a purpose, replacing any earlier one. False without the service key or when the write
// fails — the caller must not claim the webhook is stored when it isn't.
export async function saveWebhook(
  purpose: string,
  url: string,
  channel: string | null = null,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  const service = serviceClient(env);
  if (!service) return false;
  const { error } = await service.from("slack_webhooks").upsert({ purpose, url, channel }, { onConflict: "purpose" });
  return !error;
}

// The webhook for a purpose, or null. The collector posts to it (lib/feedback-send.ts).
export async function readWebhook(
  purpose: string = FEEDBACK_PURPOSE,
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  const service = serviceClient(env);
  if (!service) return null;
  const { data, error } = await service.from("slack_webhooks").select("url").eq("purpose", purpose).maybeSingle();
  if (error) return null;
  const url = (data as { url?: unknown } | null)?.url;
  return typeof url === "string" && url ? url : null;
}
