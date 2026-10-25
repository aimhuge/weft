import { randomUUID } from "node:crypto";
import { accountView } from "@/lib/account";
import { fail, guard } from "@/lib/guard";
import { cleanMessages, cleanSummary } from "@/lib/feedback";
import { saveFeedback } from "@/lib/feedback-store";
import { forwardFeedback } from "@/lib/feedback-send";

// Sends the summary you checked to the Weft team (lib/feedback-send.ts), signed with your account when you're signed
// in so they can write back, and keeps a copy in ~/.weft/feedback either way.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as { messages?: unknown; summary?: unknown };
    const summary = cleanSummary(body.summary);
    const messages = cleanMessages(body.messages);
    const user = (await accountView().catch(() => null))?.user;
    const from = user ? { name: user.name, email: user.email } : null;
    const version = process.env.NEXT_PUBLIC_APP_VERSION ?? null;
    const sent = await forwardFeedback({ summary, messages, from, version });
    saveFeedback({ id: randomUUID(), at: Date.now(), summary, messages, from, version, sent });
    return Response.json({ sent });
  } catch (err) {
    return fail(err);
  }
}
