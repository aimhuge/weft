import { shell } from "./browser-tools";
import type { SlackText } from "./slack-messages";
import type { SlackThread } from "./slack-types";

// Posting to Slack from the server: main holds the bot token and makes the call (control route POST /slack/post,
// electron/slack.cjs), so the server only ever sends the message and gets back where it landed.

export async function postToSlack(channel: string, message: SlackText, threadTs?: string): Promise<SlackThread> {
  const answer = await shell("/slack/post", { channel, ...message, ...(threadTs ? { thread_ts: threadTs } : {}) });
  return { channel: typeof answer.channel === "string" ? answer.channel : channel, ts: typeof answer.ts === "string" ? answer.ts : "" };
}

// Fire and forget, for updates nobody waits on: a Slack that's down or disconnected never fails a commit or a turn.
export function sendToSlack(channel: string, message: SlackText, threadTs?: string): void {
  postToSlack(channel, message, threadTs).catch((err: unknown) => {
    console.warn(`[weft] slack: ${err instanceof Error ? err.message : String(err)}`);
  });
}
