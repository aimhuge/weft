import { fail, guard } from "@/lib/guard";
import { growthOverview } from "@/lib/growth-read";
import { growthDashboardUrl, postGrowthSummary, summaryLines } from "@/lib/slack-growth";

// The daily growth summary (docs/architecture/slack.md): the headline numbers and the growth dashboard's
// address, posted to the growth channel.
//
// The cron card calls this once a day. It answers what it posted, so the card's own reply can say what went
// out — and say nothing when it didn't, rather than claiming a message that never arrived.

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const posted = await postGrowthSummary();
    if (!posted) {
      return Response.json(
        { ok: false, error: "The growth summary did not go out: no growth channel, no service key, or Slack refused it." },
        { status: 503 },
      );
    }
    const overview = await growthOverview();
    return Response.json({ ok: true, url: growthDashboardUrl(), lines: overview ? summaryLines(overview) : [] });
  } catch (err) {
    return fail(err);
  }
}

// The numbers without posting them: what the dashboard shows, for a card that wants to read them.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  const overview = await growthOverview();
  if (!overview) return Response.json({ error: "The growth numbers could not be read." }, { status: 503 });
  return Response.json({ url: growthDashboardUrl(), lines: summaryLines(overview), overview });
}
