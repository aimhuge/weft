import { fail, guard } from "@/lib/guard";
import { growthOverviewResult, type GrowthReadFailure } from "@/lib/growth-read";
import { growthDashboardUrl, postGrowthSummary, summaryLines, type GrowthSummaryFailure } from "@/lib/slack-growth";

// The daily growth summary (docs/architecture/slack.md): the headline numbers and the growth dashboard's
// address, posted to the growth channel.
//
// The cron card calls this once a day. It answers what it posted, so the card's own reply can say what went
// out — and say nothing when it didn't, rather than claiming a message that never arrived.

// Why the numbers could not be read, in words the person reading them can act on.
const WHY: Record<GrowthReadFailure, string> = {
  no_service_key: "no Supabase service key in the environment",
  read_failed: "the growth_overview read failed",
  empty_answer: "the growth_overview read answered with nothing",
};

// Why the summary did not go out, in the same spirit: each one needs a different fix.
const WHY_NOT_POSTED: Record<GrowthSummaryFailure, string> = {
  no_channel: "no growth channel is set",
  no_service_key: WHY.no_service_key,
  read_failed: WHY.read_failed,
  empty_answer: WHY.empty_answer,
  slack_refused: "Slack refused the message",
};

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const result = await postGrowthSummary();
    if (!result.posted) {
      const why = result.failure ? WHY_NOT_POSTED[result.failure] : "unknown reason";
      return Response.json(
        { ok: false, error: `The growth summary did not go out: ${why}.`, ...(result.detail ? { detail: result.detail } : {}) },
        { status: 503 },
      );
    }
    // The summary went out. The numbers that follow it are the same ones it carried, read again so the card can
    // say them; if that second read fails, the summary still went out and the card is told so.
    const { overview, failure, source } = await growthOverviewResult();
    return Response.json({
      ok: true,
      url: growthDashboardUrl(),
      source,
      lines: overview ? summaryLines(overview) : [],
      // When the summary went out but the numbers that follow it could not be read, say why — a reply that
      // silently drops them looks like a summary with no numbers in it.
      ...(overview ? {} : { warning: `The summary went out, but the numbers could not be read: ${failure ? WHY[failure] : "unknown reason"}.` }),
    });
  } catch (err) {
    return fail(err);
  }
}

// The numbers without posting them: what the dashboard shows, for a card that wants to read them.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  const { overview, failure, source } = await growthOverviewResult();
  if (!overview) {
    return Response.json(
      { error: `The growth numbers could not be read: ${failure ? WHY[failure] : "unknown reason"}.` },
      { status: 503 },
    );
  }
  // Where the numbers came from: the environment's key, or Electron main's vault. It answers "why did this work
  // here and not there", which is the question the packaged app raises every time.
  return Response.json({ url: growthDashboardUrl(), lines: summaryLines(overview), overview, source });
}
