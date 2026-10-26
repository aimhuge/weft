import { describe, expect, it } from "vitest";
import { lifecycle, summarize, toUserActivity, weekColumns, type ActivityDay } from "./admin-activity";

const d = (day: string, active: boolean, cards = 0): ActivityDay => ({ day, active, cards, items: cards * 10 });

describe("toUserActivity", () => {
  it("reads the RPC's jsonb, numbers from strings, bad rows dropped", () => {
    const a = toUserActivity({
      days: [{ day: "2026-10-25T00:00:00", active: true, cards: "3", items: 40 }, null, { day: 5 }, { day: "2026-10-26", active: "yes" }],
      firstActiveDay: "2026-10-05",
      cards: "751",
      sessions: 4,
      workspaces: 2,
      shares: 1,
      apps: 3,
      invitesSent: 0,
      pukuRequests: -2,
    });
    expect(a.days).toEqual([
      { day: "2026-10-25", active: true, cards: 3, items: 40 },
      { day: "2026-10-26", active: false, cards: 0, items: 0 },
    ]);
    expect(a).toMatchObject({ firstActiveDay: "2026-10-05", cards: 751, sessions: 4, workspaces: 2, shares: 1, apps: 3, pukuRequests: 0 });
  });

  it("answers an empty activity for null or junk", () => {
    expect(toUserActivity(null)).toEqual({
      days: [],
      firstActiveDay: null,
      cards: 0,
      sessions: 0,
      workspaces: 0,
      shares: 0,
      apps: 0,
      invitesSent: 0,
      pukuRequests: 0,
    });
    expect(toUserActivity({ days: "x", cards: Number.NaN }).days).toEqual([]);
  });
});

describe("summarize", () => {
  it("counts the current streak through today, the longest run and recent active days", () => {
    const days = [d("10-20", true, 2), d("10-21", true), d("10-22", true), d("10-23", false), d("10-24", true, 9), d("10-25", true)];
    expect(summarize(days)).toEqual({ active7: 5, active30: 5, streak: 2, longest: 3, peakCards: 9 });
  });

  it("keeps the streak when today has no activity yet", () => {
    expect(summarize([d("a", true), d("b", true), d("c", false)]).streak).toBe(2);
  });

  it("breaks the streak on a quiet yesterday", () => {
    expect(summarize([d("a", true), d("b", false), d("c", false)]).streak).toBe(0);
  });

  it("only looks back 7 and 30 days for the recent counts", () => {
    const days = Array.from({ length: 40 }, (_, i) => d(String(i), true));
    expect(summarize(days)).toMatchObject({ active7: 7, active30: 30, streak: 40, longest: 40 });
  });

  it("answers zeros for no days", () => {
    expect(summarize([])).toEqual({ active7: 0, active30: 0, streak: 0, longest: 0, peakCards: 0 });
  });
});

describe("lifecycle", () => {
  const now = Date.parse("2026-10-26T00:00:00Z");
  const ago = (days: number) => new Date(now - days * 86_400_000).toISOString();

  it("labels never, new, active, dormant and gone", () => {
    expect(lifecycle(null, ago(1), now)).toBe("never");
    expect(lifecycle(ago(0.1), ago(2), now)).toBe("new");
    expect(lifecycle(ago(1), ago(20), now)).toBe("active");
    expect(lifecycle(ago(6), ago(20), now)).toBe("dormant");
    expect(lifecycle(ago(31), null, now)).toBe("gone");
  });
});

describe("weekColumns", () => {
  it("pads to Monday-first weeks", () => {
    // 2026-10-07 is a Wednesday.
    const days = [d("2026-10-07", true), d("2026-10-08", false), d("2026-10-09", true), d("2026-10-10", true), d("2026-10-11", true), d("2026-10-12", true)];
    const weeks = weekColumns(days);
    expect(weeks).toHaveLength(2);
    expect(weeks[0]?.slice(0, 3)).toEqual([null, null, days[0]]);
    expect(weeks[1]?.[0]).toBe(days[5]);
    expect(weeks[1]?.slice(1)).toEqual([null, null, null, null, null, null]);
  });

  it("answers no weeks for no days", () => {
    expect(weekColumns([])).toEqual([]);
  });
});
