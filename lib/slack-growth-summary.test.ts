import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { appLinkTarget } from "./app-routes";
import type { GrowthOverview } from "./growth-read";
import type { SlackSettings } from "./slack-types";
import { GROWTH_DASHBOARD_URL, growthDashboardUrl, growthTestMessage, postGrowthSummary, summaryLines } from "./slack-growth";
import { growthSettings, OVERVIEW } from "./slack-growth.fixtures";

// The daily growth summary (lib/slack-growth.ts): the headline numbers and the growth dashboard's address, posted
// to the growth channel once a day. The events and their watermark are in lib/slack-growth.test.ts.

vi.mock("./slack-post", () => ({ postToSlack: vi.fn(() => Promise.resolve({ channel: "C9", ts: "1" })) }));

// The settings and the growth overview are the two things the daily summary needs, so both are fakes.
const fake = vi.hoisted(() => ({
  settings: null as SlackSettings | null,
  overview: null as GrowthOverview | null,
  read: null as { overview: GrowthOverview | null; failure: "no_service_key" | "read_failed" | "empty_answer" | null } | null,
}));

vi.mock("./slack-store", () => ({ slackSettings: () => fake.settings }));
vi.mock("./growth-read", async () => {
  const actual = await vi.importActual<typeof import("./growth-read")>("./growth-read");
  return {
    ...actual,
    growthOverviewResult: vi.fn(() => Promise.resolve(fake.read ?? { overview: fake.overview, failure: fake.overview ? null : "no_service_key" })),
  };
});

const { postToSlack } = await import("./slack-post");
const { growthOverviewResult } = await import("./growth-read");

beforeEach(() => {
  vi.mocked(postToSlack).mockClear();
  vi.mocked(postToSlack).mockResolvedValue({ channel: "C9", ts: "1" });
  vi.mocked(growthOverviewResult).mockClear();
  fake.read = null;
  fake.settings = growthSettings();
  fake.overview = OVERVIEW;
});

describe("the growth dashboard's address", () => {
  it("is the Growth app's shared link", () => {
    expect(growthDashboardUrl({})).toBe("https://weft.zip/@fotoflo/apps/growth");
  });

  // The old fallback, /apps/growth, was a 404: no route served it. The fallback must be a path proxy.ts
  // rewrites onto the shared-app page that exists in the app router.
  it("falls back to a path the app router serves", () => {
    const path = new URL(GROWTH_DASHBOARD_URL).pathname;
    expect(appLinkTarget(path)).toBe("/u/fotoflo/apps/growth");
    expect(existsSync(join(process.cwd(), "app/u/[username]/apps/[slug]/page.tsx"))).toBe(true);
  });

  it("takes an explicit address", () => {
    expect(growthDashboardUrl({ WEFT_GROWTH_DASHBOARD_URL: "https://x.test/growth" })).toBe("https://x.test/growth");
  });

  it("ignores an address that is only spaces", () => {
    expect(growthDashboardUrl({ WEFT_GROWTH_DASHBOARD_URL: "   " })).toBe("https://weft.zip/@fotoflo/apps/growth");
  });

  it("reads the environment when it is given none", () => {
    expect(growthDashboardUrl()).toBe("https://weft.zip/@fotoflo/apps/growth");
  });
});

describe("the daily summary", () => {
  it("posts the summary to the growth channel", async () => {
    const result = await postGrowthSummary({});
    expect(result.posted).toBe(true);
    expect(result.failure).toBeNull();
    expect(result.overview).toEqual(fake.overview);
    expect(postToSlack).toHaveBeenCalledTimes(1);
    expect(vi.mocked(postToSlack).mock.calls[0]?.[0]).toBe("C9");
  });

  it("posts nothing when there is no growth channel", async () => {
    fake.settings = { ...growthSettings(), channel: null, channelName: null, links: [], routes: {} };
    const result = await postGrowthSummary({});
    expect(result.posted).toBe(false);
    expect(result.failure).toBe("no_channel");
    expect(postToSlack).not.toHaveBeenCalled();
  });

  it("posts nothing when the numbers can't be read", async () => {
    fake.overview = null;
    const result = await postGrowthSummary({});
    expect(result.posted).toBe(false);
    expect(result.failure).toBe("no_service_key");
    expect(postToSlack).not.toHaveBeenCalled();
  });

  it("names the read that failed, so the fix is not a guess", async () => {
    // A missing key, a failed read and an empty answer each need a different fix.
    fake.read = { overview: null, failure: "read_failed" };
    expect((await postGrowthSummary({})).failure).toBe("read_failed");
    fake.read = { overview: null, failure: "empty_answer" };
    expect((await postGrowthSummary({})).failure).toBe("empty_answer");
    fake.read = { overview: null, failure: "no_service_key" };
    expect((await postGrowthSummary({})).failure).toBe("no_service_key");
  });

  it("says so when Slack refuses the summary", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(postToSlack).mockRejectedValueOnce(new Error("channel_not_found"));
    const result = await postGrowthSummary({});
    expect(result.posted).toBe(false);
    expect(result.failure).toBe("slack_refused");
    expect(result.detail).toBe("channel_not_found");
    expect(warn).toHaveBeenCalledWith("[weft] slack growth: channel_not_found");
  });

  it("says so when the refusal is not an Error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(postToSlack).mockRejectedValueOnce("offline");
    const result = await postGrowthSummary({});
    expect(result.posted).toBe(false);
    expect(result.failure).toBe("slack_refused");
    expect(result.detail).toBe("offline");
    expect(warn).toHaveBeenCalledWith("[weft] slack growth: offline");
  });

  it("reads the numbers with the environment it is given", async () => {
    await postGrowthSummary({ SUPABASE_SECRET_KEY: "key" });
    expect(growthOverviewResult).toHaveBeenCalledWith({ SUPABASE_SECRET_KEY: "key" });
  });

  it("reads the environment when it is given none", async () => {
    await postGrowthSummary();
    expect(growthOverviewResult).toHaveBeenCalledWith(process.env);
  });

  it("says the numbers in four lines", () => {
    expect(summaryLines(OVERVIEW)).toEqual([
      "3 new in 7 days (9 in 30)",
      "12 accounts, 5 signed in this week",
      "6 workspaces, 2 paying",
      "21 cards synced by 4 accounts",
    ]);
  });

  it("has a test message for the drawer's button", () => {
    const message = growthTestMessage();
    expect(message.text).toBe("Growth is on");
    expect(JSON.stringify(message.blocks)).toContain("Growth is on");
  });
});
