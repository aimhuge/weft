import { beforeEach, describe, expect, it, vi } from "vitest";

import { growthEvents, type GrowthEvent } from "./growth-read";
import { createGrowthWatch, newEvents, nextWatermark, postGrowthEvents } from "./slack-growth";

// Growth in Slack (lib/slack-growth.ts): the new users, new teams and payments, posted to the growth channel.
//
// The watermark is the whole design. The read says "everything since a time", so without remembering where it
// got to, every poll would post the same sign-up again.

vi.mock("./slack-post", () => ({ postToSlack: vi.fn(() => Promise.resolve({ channel: "C9", ts: "1" })) }));
vi.mock("./slack-store", () => ({
  slackSettings: vi.fn(() => ({
    channel: "C1",
    channelName: "general",
    folder: null,
    links: [],
    events: { commits: true, pushes: true, deploys: true, status: true, growth: true },
    routes: { growth: { channel: "C9", channelName: "growth" } },
  })),
}));

const { postToSlack } = await import("./slack-post");

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
});

describe("growthEvents", () => {
  it("answers nothing without the service key", async () => {
    expect(await growthEvents(new Date(), { SUPABASE_SECRET_KEY: undefined })).toEqual([]);
  });
});
