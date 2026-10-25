import { fail, guard } from "@/lib/guard";
import { testMessage } from "@/lib/slack-messages";
import { postToSlack } from "@/lib/slack-post";
import { slackSettings } from "@/lib/slack-store";

// The drawer's "Send a test message": one post to the channel, so a missing scope or an uninvited bot shows up now
// rather than on the next commit.

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const { channel } = slackSettings();
    if (!channel) throw new Error("Pick a channel first.");
    return Response.json(await postToSlack(channel, testMessage()));
  } catch (err) {
    return fail(err);
  }
}
