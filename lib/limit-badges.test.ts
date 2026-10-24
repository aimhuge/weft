import { describe, expect, it } from "vitest";
import { burnMs, fastestBurn, LIMIT_DEFS, LIMIT_LADDER, liveHit, resetTime, zonedTime } from "./limit-badges";
import type { LimitHit } from "./usage";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const test = (id: string) => LIMIT_DEFS.find((d) => d.id === id)!.test;
const local = (d: number, h: number, mi = 0) => new Date(2026, 9, d, h, mi).getTime();
const five = (at: number, resetAt?: number): LimitHit => ({ at, kind: "five_hour", ...(resetAt && { resetAt }) });

describe("zonedTime", () => {
  it("reads a wall-clock time in a zone", () => {
    expect(zonedTime(2026, 9, 20, 2, 30, "Asia/Bangkok")).toBe(Date.UTC(2026, 9, 19, 19, 30));
    expect(zonedTime(2026, 9, 20, 12, 0, "America/New_York")).toBe(Date.UTC(2026, 9, 20, 16, 0));
  });

  it("falls back to the Mac's own zone", () => {
    expect(zonedTime(2026, 9, 20, 2, 30)).toBe(new Date(2026, 9, 20, 2, 30).getTime());
    expect(zonedTime(2026, 9, 20, 2, 30, "Not/AZone")).toBe(new Date(2026, 9, 20, 2, 30).getTime());
  });
});

describe("resetTime", () => {
  const at = Date.UTC(2026, 9, 19, 17, 0); // 00:00 on Oct 20 in Bangkok

  it("takes the next such time after the hit", () => {
    expect(resetTime("2:30am (Asia/Bangkok)", at)).toBe(Date.UTC(2026, 9, 19, 19, 30));
    expect(resetTime("12pm (Asia/Bangkok)", at)).toBe(Date.UTC(2026, 9, 20, 5, 0));
    expect(resetTime("11:30pm (Asia/Bangkok)", at)).toBe(Date.UTC(2026, 9, 20, 16, 30));
  });

  it("reads a dated reset and an epoch", () => {
    expect(resetTime("Oct 22, 9pm (Asia/Bangkok)", at)).toBe(Date.UTC(2026, 9, 22, 14, 0));
    expect(resetTime("Jan 2, 9am (Asia/Bangkok)", at)).toBe(Date.UTC(2027, 0, 2, 2, 0));
    expect(resetTime("1792000000", at)).toBe(1792000000000);
  });

  it("gives up on what it can't read", () => {
    expect(resetTime("soon", at)).toBeUndefined();
    expect(resetTime("Foo 2, 9am", at)).toBeUndefined();
  });
});

describe("liveHit", () => {
  it("reads the reset from the event id, in seconds or ms", () => {
    expect(liveHit("limit:five_hour:1792000000", 5, "five_hour")).toEqual({ at: 5, kind: "five_hour", resetAt: 1792000000000 });
    expect(liveHit("limit:seven_day:1792000000000", 5, "seven_day")).toEqual({ at: 5, kind: "seven_day", resetAt: 1792000000000 });
    expect(liveHit("3f2a-uuid", 5, "five_hour")).toEqual({ at: 5, kind: "five_hour" });
  });
});

describe("burnMs", () => {
  it("is how long the window lasted before the hit", () => {
    expect(burnMs(five(10 * HOUR, 11 * HOUR))).toBe(4 * HOUR);
    expect(burnMs({ at: Date.UTC(2026, 9, 19, 18, 0), kind: "five_hour", reset: "2:30am (Asia/Bangkok)" })).toBe(3.5 * HOUR);
  });

  it("is unknown without a sensible reset", () => {
    expect(burnMs(five(10 * HOUR))).toBeUndefined();
    expect(burnMs({ at: 5, kind: "five_hour", reset: "whenever" })).toBeUndefined();
    expect(burnMs(five(10 * HOUR, 20 * HOUR))).toBeUndefined();
    expect(burnMs(five(10 * HOUR, 5 * HOUR))).toBeUndefined();
  });
});

describe("fastestBurn", () => {
  it("picks the shortest window of a kind", () => {
    const hits = [five(10 * HOUR, 11 * HOUR), five(30 * HOUR, 34.5 * HOUR), five(50 * HOUR), { at: 60 * HOUR, kind: "seven_day" as const, resetAt: 61 * HOUR }];
    expect(fastestBurn(hits, "five_hour")).toEqual({ ms: 0.5 * HOUR, at: 30 * HOUR });
    expect(fastestBurn(hits, "seven_day")).toEqual({ ms: 7 * DAY - HOUR, at: 60 * HOUR });
    expect(fastestBurn([], "five_hour")).toBeUndefined();
  });
});

describe("ladders", () => {
  it("has a rung per ladder step for both windows, keeping the old first ids", () => {
    expect(LIMIT_DEFS.filter((d) => d.id.startsWith("limit-5h")).length).toBe(LIMIT_LADDER.length);
    expect(LIMIT_DEFS.filter((d) => d.id.startsWith("limit-7d")).length).toBe(LIMIT_LADDER.length);
    expect(LIMIT_DEFS.map((d) => d.id)).toEqual(expect.arrayContaining(["limit-5h", "limit-7d", "limit-5h-1000", "limit-7d-250"]));
    expect(new Set(LIMIT_DEFS.map((d) => d.id)).size).toBe(LIMIT_DEFS.length);
  });

  it("counts hits of one window, dated by the nth", () => {
    const hits = [five(3), five(1), five(2), { at: 9, kind: "seven_day" as const }];
    expect(test("limit-5h")(hits)).toEqual({ unlocked: true, at: 1, have: 1, need: 1 });
    expect(test("limit-5h-2")(hits)).toEqual({ unlocked: true, at: 2, have: 2, need: 2 });
    expect(test("limit-5h-5")(hits)).toEqual({ unlocked: false, at: undefined, have: 3, need: 5 });
    expect(test("limit-7d")(hits)).toMatchObject({ unlocked: true, at: 9 });
    expect(LIMIT_DEFS.find((d) => d.id === "limit-5h-1000")?.desc).toBe("Use up your 5-hour plan limit 1,000 times");
    expect(LIMIT_DEFS.find((d) => d.id === "limit-7d-2")?.desc).toBe("Use up your weekly plan limit twice");
  });
});

describe("speed badges", () => {
  it("unlock on the first window burned fast enough", () => {
    const hits = [five(10 * HOUR, 13.5 * HOUR), five(30 * HOUR, 34.6 * HOUR)];
    expect(test("burn-5h-2h")(hits)).toEqual({ unlocked: true, at: 10 * HOUR });
    expect(test("burn-5h-30m")(hits)).toEqual({ unlocked: true, at: 30 * HOUR });
    expect(test("burn-5h-15m")(hits)).toEqual({ unlocked: false, at: undefined });
    expect(test("burn-5h-2h")([five(10 * HOUR)])).toEqual({ unlocked: false, at: undefined });
    expect(test("burn-7d-1d")([{ at: 10 * DAY, kind: "seven_day", resetAt: 16.5 * DAY }])).toEqual({ unlocked: true, at: 10 * DAY });
  });
});

describe("day badges", () => {
  it("count 5-hour hits on one local day", () => {
    const hits = [five(local(21, 2)), five(local(21, 9)), five(local(20, 1)), five(local(20, 8)), five(local(20, 15))];
    expect(test("limit-day-2")(hits)).toEqual({ unlocked: true, at: local(20, 8) });
    expect(test("limit-day-3")(hits)).toEqual({ unlocked: true, at: local(20, 15) });
    expect(test("limit-day-4")(hits)).toEqual({ unlocked: false, at: undefined });
  });

  it("count days in a row", () => {
    const hits = [five(local(1, 9)), five(local(3, 9)), five(local(4, 9)), five(local(4, 18)), five(local(5, 9))];
    expect(test("limit-row-3")(hits)).toEqual({ unlocked: true, at: local(5, 9), have: 3, need: 3 });
    expect(test("limit-row-7")(hits)).toEqual({ unlocked: false, have: 3, need: 7 });
    expect(test("limit-row-7")([])).toEqual({ unlocked: false, have: 0, need: 7 });
  });

  it("double dip needs both windows within a day", () => {
    const week = { at: local(10, 20), kind: "seven_day" as const };
    expect(test("limit-double")([five(local(10, 9)), week])).toEqual({ unlocked: true, at: local(10, 20) });
    expect(test("limit-double")([five(local(10, 21)), week])).toEqual({ unlocked: true, at: local(10, 21) });
    expect(test("limit-double")([five(local(1, 9)), week])).toEqual({ unlocked: false, at: undefined });
  });
});
