import { fail, guard } from "@/lib/guard";
import { asText } from "@/lib/format";
import { handleInbound } from "@/lib/slack-inbound";

// Slack talking to Weft, forwarded by Electron main (electron/slack.cjs), which hears `/weft` and @mentions over
// Socket Mode and has already acked Slack. The guard's write check is the launch token main sends.

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const kind = body.kind === "mention" ? "mention" : "command";
    const channel = asText(body.channel).trim();
    if (!channel) throw new Error("A Slack message needs its channel.");
    const ts = asText(body.ts) || undefined;
    const threadTs = asText(body.threadTs) || undefined;
    const result = await handleInbound({ kind, text: asText(body.text), channel, user: asText(body.user), ts, threadTs });
    return Response.json(result);
  } catch (err) {
    return fail(err);
  }
}
