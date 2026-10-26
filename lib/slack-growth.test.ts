import { beforeEach, describe, expect, it, vi } from "vitest";

import { growthEvents, type GrowthEvent, type GrowthOverview } from "./growth-read";
import type { SlackSettings } from "./slack-types";
import {
  createGrowthWatch,
  FIRST_WINDOW_MS,
  growthDashboardUrl,
  growthTestMessage,
  newEvents,
  nextWatermark,
  postGrowthEvents,
  postGrowthSummary,
  summaryLines,
} from "./slack-growth";

// Growth in Slack (lib/slack-growth.ts): the new users, new teams and payments, posted to the growth channel.
//
// The watermark is the whole design. The read says "everything since a time", so without remembering where it
// got to, every poll would post the same sign-up again.

vi.mock("./slack-post", () => ({ postToSlack: vi.fn(() => Promise.resolve({ channel: "C9", ts: "1" })) }));

// The settings and the growth overview are the two things the daily summary needs, so both are fakes.
// The settings are typed so a test can change them the way the drawer would.
const fake = vi.hoisted(() => {
  const settings: SlackSettings = {
    channel: "C1",
    channelName: "general",
    folder: null,
    links: [],
    events: { commits: true, pushes: true, deploys: true, status: true, growth: true },
    routes: { growth: { channel: "C9", channelName: "growth" } },
  };
  return { settings, overview: null as GrowthOverview | null };
});

vi.mock("./slack-store", () => ({ slackSettings: () => fake.settings }));
vi.mock("./growth-read", async () => {
  const actual = await vi.importActual<typeof import("./growth-read")>("./growth-read");
  return { ...actual, growthOverview: vi.fn(() => Promise.resolve(fake.overview)) };
});

const { postToSlack } = await import("./slack-post");
const { growthOverview } = await import("./growth-read");

const OVERVIEW: GrowthOverview = {
  accounts: 12,
  new_7d: 3,
  new_30d: 9,
  signed_in_7d: 5,
  signed_in_30d: 8,
  never_signed_in: 2,
  workspaces: 6,
  invites_pending: 1,
  syncing_accounts: 4,
  synced_cards: 21,
  paying_workspaces: 2,
};

const user = (id: string, at: string): GrowthEvent => ({ kind: "user", id, email: "someone@example.com", at });
const team = (id: string, at: string): GrowthEvent => ({ kind: "team", id, name: "Acme", slug: "acme", members: 3, at });
const payment = (id: string, at: string): GrowthEvent => ({
  kind: "payment",
  id,
  event: "invoice.paid",
  org: "AimHuge",
  slug: "aimhuge",
  actor: null,
  plan: "pro",
  status: "active",
  amount_cents: 2000,
  currency: "usd",
  seats: 1,
  at,
});

beforeEach(() => {
  vi.mocked(postToSlack).mockClear();
  vi.mocked(postToSlack).mockResolvedValue({ channel: "C9", ts: "1" });
  vi.mocked(growthOverview).mockClear();
  fake.settings = {
    channel: "C1",
    channelName: "general",
    folder: null,
    links: [],
    events: { commits: true, pushes: true, deploys: true, status: true, growth: true },
    routes: { growth: { channel: "C9", channelName: "growth" } },
  };
  fake.overview = OVERVIEW;
});

describe("newEvents", () => {
  it("keeps everything when there is no watermark yet", () => {
    const events = [user("u1", "2026-10-20T10:00:00Z"), team("t1", "2026-10-21T10:00:00Z")];
    expect(newEvents(events, null)).toHaveLength(2);
  });

  it("keeps only what is newer than the watermark", () => {
    const events = [user("u1", "2026-10-20T10:00:00Z"), team("t1", "2026-10-21T10:00:00Z")];
    expect(newEvents(events, new Date("2026-10-20T12:00:00Z"))).toEqual([team("t1", "2026-10-21T10:00:00Z")]);
  });

  it("keeps an event at the watermark's own second, so two in a second are both read", () => {
    const events = [user("u1", "2026-10-20T10:00:00Z"), user("u2", "2026-10-20T10:00:00Z")];
    expect(newEvents(events, new Date("2026-10-20T09:59:59Z"))).toHaveLength(2);
  });
});

describe("nextWatermark", () => {
  it("is the newest event's time", () => {
    expect(nextWatermark([user("u1", "2026-10-20T10:00:00Z"), team("t1", "2026-10-21T10:00:00Z")], null)).toBe("2026-10-21T10:00:00.000Z");
  });

  it("keeps the old one when there is nothing new", () => {
    expect(nextWatermark([], "2026-10-21T10:00:00.000Z")).toBe("2026-10-21T10:00:00.000Z");
  });

  it("never goes backwards", () => {
    expect(nextWatermark([user("u1", "2026-10-19T10:00:00Z")], "2026-10-21T10:00:00.000Z")).toBe("2026-10-21T10:00:00.000Z");
  });
});

describe("postGrowthEvents", () => {
  it("posts each new event to the growth channel", async () => {
    const saved: { at: string | null }[] = [];
    const posted = await postGrowthEvents(
      [user("u1", "2026-10-20T10:00:00Z"), team("t1", "2026-10-21T10:00:00Z")],
      { at: null },
      (w) => saved.push(w),
    );
    expect(posted).toBe(2);
    expect(postToSlack).toHaveBeenCalledTimes(2);
    expect(vi.mocked(postToSlack).mock.calls[0]?.[0]).toBe("C9");
    expect(saved.at(-1)?.at).toBe("2026-10-21T10:00:00.000Z");
  });

  it("posts nothing when the watermark says they are already there", async () => {
    const posted = await postGrowthEvents([user("u1", "2026-10-20T10:00:00Z")], { at: "2026-10-21T00:00:00.000Z" }, () => {});
    expect(posted).toBe(0);
    expect(postToSlack).not.toHaveBeenCalled();
  });

  it("keeps the watermark where it was when Slack refuses a message", async () => {
    vi.mocked(postToSlack).mockRejectedValueOnce(new Error("channel_not_found"));
    const saved: { at: string | null }[] = [];
    const posted = await postGrowthEvents(
      [user("u1", "2026-10-20T10:00:00Z"), team("t1", "2026-10-21T10:00:00Z")],
      { at: null },
      (w) => saved.push(w),
    );
    expect(posted).toBe(0);
    // The watermark didn't move, so the failed event is read again next time.
    expect(saved.at(-1)?.at ?? null).toBeNull();
  });

  it("posts only the ones that worked, and stops at the one that failed", async () => {
    vi.mocked(postToSlack).mockResolvedValueOnce({ channel: "C9", ts: "1" }).mockRejectedValueOnce(new Error("nope"));
    const saved: { at: string | null }[] = [];
    const posted = await postGrowthEvents(
      [user("u1", "2026-10-20T10:00:00Z"), team("t1", "2026-10-21T10:00:00Z"), user("u2", "2026-10-22T10:00:00Z")],
      { at: null },
      (w) => saved.push(w),
    );
    expect(posted).toBe(1);
    expect(postToSlack).toHaveBeenCalledTimes(2);
    expect(saved.at(-1)?.at).toBe("2026-10-20T10:00:00.000Z");
  });

  it("posts a payment like any other event", async () => {
    const saved: { at: string | null }[] = [];
    const posted = await postGrowthEvents([payment("p1", "2026-10-21T10:00:00Z")], { at: null }, (w) => saved.push(w));
    expect(posted).toBe(1);
    expect(vi.mocked(postToSlack).mock.calls[0]?.[0]).toBe("C9");
    expect(saved.at(-1)?.at).toBe("2026-10-21T10:00:00.000Z");
  });

  it("posts nothing when growth is switched off", async () => {
    fake.settings = { ...fake.settings, events: { commits: true, pushes: true, deploys: true, status: true, growth: false } };
    const posted = await postGrowthEvents([user("u1", "2026-10-20T10:00:00Z")], { at: null }, () => {});
    expect(posted).toBe(0);
    expect(postToSlack).not.toHaveBeenCalled();
  });

  it("posts nothing when there is no growth channel", async () => {
    fake.settings = { ...fake.settings, channel: null, channelName: null, links: [], routes: {} };
    const posted = await postGrowthEvents([user("u1", "2026-10-20T10:00:00Z")], { at: null }, () => {});
    expect(posted).toBe(0);
    expect(postToSlack).not.toHaveBeenCalled();
  });

  it("says so when the failure is not an Error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(postToSlack).mockRejectedValueOnce("offline");
    await postGrowthEvents([user("u1", "2026-10-20T10:00:00Z")], { at: null }, () => {});
    expect(warn).toHaveBeenCalledWith("[weft] slack growth: offline");
  });
});

describe("createGrowthWatch", () => {
  it("reads from the watermark and saves where it got to", async () => {
    const read = vi.fn(() => Promise.resolve([user("u1", "2026-10-20T10:00:00Z")]));
    let watermark: { at: string | null } = { at: null };
    const save = vi.fn((w: { at: string | null }) => {
      watermark = w;
    });
    const watch = createGrowthWatch(read, () => watermark, save);
    await watch.tick();
    expect(read).toHaveBeenCalledTimes(1);
    expect(watermark.at).toBe("2026-10-20T10:00:00.000Z");
    expect(postToSlack).toHaveBeenCalledTimes(1);
  });

  it("does not read twice at once", async () => {
    const release: { fn: (() => void) | null } = { fn: null };
    const read = vi.fn(() => new Promise<GrowthEvent[]>((resolve) => {
      release.fn = () => resolve([]);
    }));
    const watch = createGrowthWatch(read, () => ({ at: null }), () => {});
    const first = watch.tick();
    const second = watch.tick();
    await second;
    release.fn?.();
    await first;
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("looks a week back on the very first look", async () => {
    const read = vi.fn<(since: Date) => Promise<GrowthEvent[]>>(() => Promise.resolve([]));
    const watch = createGrowthWatch(read, () => ({ at: null }), () => {});
    const before = Date.now();
    await watch.tick();
    const since = read.mock.calls[0]?.[0] as Date;
    // The window is a week, and it is measured from now.
    expect(before - since.getTime()).toBeGreaterThan(FIRST_WINDOW_MS - 5_000);
    expect(before - since.getTime()).toBeLessThanOrEqual(FIRST_WINDOW_MS);
  });

  it("reads from the watermark when there is one", async () => {
    const read = vi.fn<(since: Date) => Promise<GrowthEvent[]>>(() => Promise.resolve([]));
    const watch = createGrowthWatch(read, () => ({ at: "2026-10-20T10:00:00.000Z" }), () => {});
    await watch.tick();
    expect((read.mock.calls[0]?.[0] as Date).toISOString()).toBe("2026-10-20T10:00:00.000Z");
  });
});

describe("the growth dashboard's address", () => {
  it("is the deployed dashboard", () => {
    expect(growthDashboardUrl({})).toBe("https://weft.zip/apps/growth");
  });

  it("takes an explicit address", () => {
    expect(growthDashboardUrl({ WEFT_GROWTH_DASHBOARD_URL: "https://x.test/growth" })).toBe("https://x.test/growth");
  });

  it("ignores an address that is only spaces", () => {
    expect(growthDashboardUrl({ WEFT_GROWTH_DASHBOARD_URL: "   " })).toBe("https://weft.zip/apps/growth");
  });

  it("reads the environment when it is given none", () => {
    expect(growthDashboardUrl()).toBe("https://weft.zip/apps/growth");
  });
});

describe("the daily summary", () => {
  it("posts the summary to the growth channel", async () => {
    expect(await postGrowthSummary({})).toBe(true);
    expect(postToSlack).toHaveBeenCalledTimes(1);
    expect(vi.mocked(postToSlack).mock.calls[0]?.[0]).toBe("C9");
  });

  it("posts nothing when there is no growth channel", async () => {
    fake.settings = { ...fake.settings, channel: null, channelName: null, links: [], routes: {} };
    expect(await postGrowthSummary({})).toBe(false);
    expect(postToSlack).not.toHaveBeenCalled();
  });

  it("posts nothing when the numbers can't be read", async () => {
    fake.overview = null;
    expect(await postGrowthSummary({})).toBe(false);
    expect(postToSlack).not.toHaveBeenCalled();
  });

  it("says so when Slack refuses the summary", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(postToSlack).mockRejectedValueOnce(new Error("channel_not_found"));
    expect(await postGrowthSummary({})).toBe(false);
    expect(warn).toHaveBeenCalledWith("[weft] slack growth: channel_not_found");
  });

  it("says so when the refusal is not an Error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(postToSlack).mockRejectedValueOnce("offline");
    expect(await postGrowthSummary({})).toBe(false);
    expect(warn).toHaveBeenCalledWith("[weft] slack growth: offline");
  });

  it("reads the numbers with the environment it is given", async () => {
    await postGrowthSummary({ SUPABASE_SECRET_KEY: "key" });
    expect(growthOverview).toHaveBeenCalledWith({ SUPABASE_SECRET_KEY: "key" });
  });

  it("reads the environment when it is given none", async () => {
    await postGrowthSummary();
    expect(growthOverview).toHaveBeenCalledWith(process.env);
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

describe("growthEvents", () => {
  it("answers nothing without the service key", async () => {
    expect(await growthEvents(new Date(), { SUPABASE_SECRET_KEY: undefined })).toEqual([]);
  });
});
