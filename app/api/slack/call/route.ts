import { fail, guard } from "@/lib/guard";
import { shell } from "@/lib/browser-tools";

// Any Slack Web API method, with the bot token Electron main holds (control route POST /slack/call,
// electron/slack.cjs). The token never comes to the server: main makes the call and hands back the answer.

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const { method, body } = (await req.json()) as { method?: string; body?: Record<string, unknown> };
    return Response.json(await shell("/slack/call", { method: method ?? "", body: body ?? {} }));
  } catch (err) {
    return fail(err);
  }
}
