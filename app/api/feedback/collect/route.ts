import { collectFeedback } from "@/lib/feedback-send";

// The deployed Weft's collector for the feedback dot (lib/feedback-send.ts). Every Mac posts here, so it has no
// localhost guard: it takes a checked summary, rate-limited per address, and posts it to the team's Slack.
export async function POST(req: Request) {
  const body: unknown = await req.json().catch(() => null);
  const key = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return new Response(null, { status: await collectFeedback(body, key) });
}
