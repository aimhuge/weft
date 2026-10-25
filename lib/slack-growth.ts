import { growthOverview, type GrowthEvent, type GrowthOverview } from "./growth-read";
import { growthMessage, growthSummaryMessage } from "./slack-messages";
import { postToSlack } from "./slack-post";
import { channelFor } from "./slack-route";
import { slackSettings } from "./slack-store";
import type { SlackText } from "./slack-messages";

// Growth in Slack (docs/architecture/slack.md): the new users, new teams and payments, posted to the growth
// channel as they happen.
//
// The watermark is the point. The rows live in production Supabase and the read says "everything since a time",
// so Weft has to remember where it got to — otherwise every poll would post the same sign-up again. The
// watermark is kept in ~/.weft/slack.json next to the rest of the Slack settings, and it only moves forward
// after a successful post, so a failed post is retried rather than lost.

export const GROWTH_MS = 5 * 60_000;

// How far back to look on the very first look: a week of events, so a channel that was switched on today still
// says something about the recent past.
export const FIRST_WINDOW_MS = 7 * 24 * 60 * 60_000;

// The watermark: the time of the newest event posted, or null when nothing has been posted yet.
export interface GrowthWatermark {
  at: string | null;
}

// Which events are new since the watermark. The watermark is a time, not a set of ids, so two events in the same
// second are both kept — the last one wins for the watermark, and nothing is lost.
export function newEvents(events: GrowthEvent[], since: Date | null): GrowthEvent[] {
  if (!since) return events;
  const floor = since.getTime();
  return events.filter((e) => {
    const at = Date.parse(e.at);
    return Number.isFinite(at) && at > floor;
  });
}

// The newest event's time: the watermark's next value. Null when there is nothing.
export function nextWatermark(events: GrowthEvent[], previous: string | null): string | null {
  const times = events.map((e) => Date.parse(e.at)).filter((t) => Number.isFinite(t));
  if (!times.length) return previous;
  const newest = new Date(Math.max(...times)).toISOString();
  // Never move the watermark backwards.
  if (previous && Date.parse(previous) > Date.parse(newest)) return previous;
  return newest;
}

// Posts the growth events that are new, one message each, and moves the watermark.
// Returns how many were posted.
export async function postGrowthEvents(
  events: GrowthEvent[],
  watermark: GrowthWatermark,
  saveWatermark: (w: GrowthWatermark) => void,
): Promise<number> {
  const settings = slackSettings();
  if (!settings.events.growth) return 0;
  const channel = channelFor(settings, "", "growth");
  if (!channel) return 0;

  const since = watermark.at ? new Date(watermark.at) : null;
  const fresh = newEvents(events, since);
  if (!fresh.length) return 0;

  let posted = 0;
  for (const event of fresh) {
    try {
      await postToSlack(channel, growthMessage(event));
      posted += 1;
    } catch (err) {
      // A channel that refuses one message shouldn't lose the rest: the watermark stops at the last success,
      // so the failed event is read again next time.
      console.warn(`[weft] slack growth: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
  }

  // The watermark moves to the newest event that was posted, not the newest that was seen.
  const postedEvents = posted === fresh.length ? fresh : fresh.slice(0, posted);
  const at = nextWatermark(postedEvents, watermark.at);
  if (at !== watermark.at) saveWatermark({ at });
  return posted;
}

// The watcher: reads the events since the watermark, posts the new ones, and remembers where it got to.
export function createGrowthWatch(
  read: (since: Date) => Promise<GrowthEvent[]>,
  watermark: () => GrowthWatermark,
  saveWatermark: (w: GrowthWatermark) => void,
) {
  let busy = false;

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const current = watermark();
      const since = current.at ? new Date(current.at) : new Date(Date.now() - FIRST_WINDOW_MS);
      const events = await read(since);
      await postGrowthEvents(events, current, saveWatermark);
    } finally {
      busy = false;
    }
  }

  return { tick };
}

// The message a growth event posts, for the drawer's test button and the tests.
export function growthTestMessage(): SlackText {
  return { text: "Growth is on", blocks: [{ type: "section", text: { type: "mrkdwn", text: "📈 *Growth is on.* New users, new teams and payments land here." } }] };
}

// ── The daily summary ──────────────────────────────────────────────────────────────────────────────────
//
// The cron card posts one summary a day (docs/architecture/slack.md): the headline numbers and the growth
// dashboard's address. It goes to the growth channel, or the default channel when there is none.

/** The address of the growth dashboard: the local mini app, or the deployed one. */
export function growthDashboardUrl(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.WEFT_GROWTH_DASHBOARD_URL?.trim();
  if (explicit) return explicit;
  return "https://weft.zip/apps/growth";
}

/**
 * Posts the daily growth summary to the growth channel. False when there is no channel, no service key, or
 * Slack refused it — the caller says so rather than pretending it went out.
 */
export async function postGrowthSummary(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const settings = slackSettings();
  const channel = channelFor(settings, "", "growth");
  if (!channel) return false;
  const overview = await growthOverview(env);
  if (!overview) return false;
  try {
    await postToSlack(channel, growthSummaryMessage(overview, growthDashboardUrl(env)));
    return true;
  } catch (err) {
    console.warn(`[weft] slack growth: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

// The summary's numbers, for the cron card's own reply.
export function summaryLines(overview: GrowthOverview): string[] {
  return [
    `${String(overview.new_7d)} new in 7 days (${String(overview.new_30d)} in 30)`,
    `${String(overview.accounts)} accounts, ${String(overview.signed_in_7d)} signed in this week`,
    `${String(overview.workspaces)} workspaces, ${String(overview.paying_workspaces)} paying`,
    `${String(overview.synced_cards)} cards synced by ${String(overview.syncing_accounts)} accounts`,
  ];
}
