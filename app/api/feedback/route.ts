import { fail, guard } from "@/lib/guard";
import { cleanMessages, parseSummary, parseTurn, summaryPrompt, turnPrompt } from "@/lib/feedback";
import { complete } from "@/lib/haiku";

// The feedback dot's interview (components/FeedbackDot.tsx): the transcript in, Haiku's next question out, or the
// summary once it has heard enough (or `wrap` asks for it now).
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as { messages?: unknown; wrap?: unknown };
    const messages = cleanMessages(body.messages);
    if (body.wrap === true) return Response.json(parseSummary(await complete(summaryPrompt(messages))));
    return Response.json(parseTurn(await complete(turnPrompt(messages))));
  } catch (err) {
    return fail(err);
  }
}
