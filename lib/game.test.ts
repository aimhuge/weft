import { describe, expect, it } from "vitest";
import {
  activeDays, addDays, cloth, dayKey, eventXp, levelFor, MAX_FREEZES, records, streakOf, tallyDays, weekOf, weekShipped, weekXp,
  type ActivityEvent,
} from "./game";

// Local times, so day keys match wherever the tests run.
const at = (day: number, hour = 10, month = 9) => new Date(2026, month, day, hour).getTime();
let seq = 0;
const ev = (kind: ActivityEvent["kind"], when: number, extra: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id: `e${++seq}`, kind, at: when, cwd: "/repo", card: extra.card ?? `c${seq}`, ...extra,
});
const same = (cwd: string) => cwd;

describe("levels", () => {
  it("starts at level 1 Thread and climbs on a square curve", () => {
    expect(levelFor(0)).toEqual({ level: 1, title: "Thread", floor: 0, next: 40 });
    expect(levelFor(40).level).toBe(2);
    expect(levelFor(-5).level).toBe(1);
    expect(levelFor(40 * 14 ** 2)).toMatchObject({ level: 15, title: "Bolt" });
    expect(levelFor(40 * 29 ** 2).title).toBe("Tapestry");
  });
});

describe("days", () => {
  it("keys, adds and finds the Monday of a week", () => {
    expect(dayKey(at(11))).toBe("2026-10-11");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    // Sunday 11 Oct 2026 belongs to the week of Monday 5 Oct.
    expect(weekOf("2026-10-11")).toBe("2026-10-05");
    expect(weekOf("2026-10-12")).toBe("2026-10-12");
  });
});

describe("eventXp and tallyDays", () => {
  it("weighs shipping most and adds the quality bonus in a healthy project", () => {
    expect(eventXp(ev("created", 1), null)).toBe(2);
    expect(eventXp(ev("turn", 1, { turns: 3 }), null)).toBe(3);
    expect(eventXp(ev("turn", 1), null)).toBe(1);
    expect(eventXp(ev("done", 1), null)).toBe(10);
    expect(eventXp(ev("done", 1), 79)).toBe(10);
    expect(eventXp(ev("done", 1), 80)).toBe(15);
    expect(eventXp(ev("quality", 1), 90)).toBe(0);
  });

  it("adds up each day, using the latest quality snapshot before each ship", () => {
    const events = [
      ev("created", at(10)),
      ev("turn", at(10, 11), { turns: 2 }),
      ev("done", at(10, 12)),
      ev("quality", at(10, 13), { cwd: "/repo", score: 90 }),
      ev("quality", at(10, 9), { cwd: "/repo", score: 50 }),
      ev("quality", at(10, 9), { cwd: "/other" }),
      ev("done", at(11)),
      ev("done", at(11), { cwd: undefined }),
      ev("start", at(11), { running: 3 }),
      ev("explore", at(12), { feature: "vault" }),
    ];
    const days = tallyDays(events, same);
    // A first use of a feature earns nothing and keeps no streak.
    expect(days.has("2026-10-12")).toBe(false);
    expect(days.get("2026-10-10")).toEqual({ cards: 1, turns: 2, done: 1, xp: 2 + 2 + 10 });
    expect(days.get("2026-10-11")).toEqual({ cards: 0, turns: 0, done: 2, xp: 15 + 10 });
    expect(activeDays(new Map([["2026-10-01", { cards: 0, turns: 0, done: 0, xp: 0 }], ...days]))).toEqual(new Set(["2026-10-10", "2026-10-11"]));
  });
});

describe("streakOf", () => {
  it("is empty with no activity", () => {
    expect(streakOf(new Set(), "2026-10-11")).toEqual({ current: 0, best: 0, freezes: 0, frozen: [], atRisk: false, reached: {} });
  });

  it("counts days in a row and doesn't break on an empty today", () => {
    const s = streakOf(new Set(["2026-10-08", "2026-10-09", "2026-10-10"]), "2026-10-11");
    expect(s).toMatchObject({ current: 3, best: 3, atRisk: true, reached: { 3: "2026-10-10" } });
  });

  it("ends on a missed day without a freeze", () => {
    const s = streakOf(new Set(["2026-10-07", "2026-10-08", "2026-10-10", "2026-10-11"]), "2026-10-11");
    expect(s).toMatchObject({ current: 2, best: 2, atRisk: false, frozen: [] });
  });

  it("earns a freeze every 7 days, up to the cap, and spends one on a missed day", () => {
    const active = new Set<string>();
    for (let i = 0; i < 21; i++) active.add(addDays("2026-09-01", i));
    // 22 Sep missed, 23 Sep active again.
    active.add("2026-09-23");
    const s = streakOf(active, "2026-09-23");
    expect(s.frozen).toEqual(["2026-09-22"]);
    expect(s.current).toBe(22);
    expect(s.freezes).toBe(MAX_FREEZES - 1);
  });
});

describe("cloth", () => {
  it("lays out whole weeks ending this week, toned against the best day", () => {
    const days = new Map([
      ["2026-10-05", { cards: 1, turns: 0, done: 0, xp: 100 }],
      ["2026-10-06", { cards: 1, turns: 0, done: 0, xp: 10 }],
      ["2026-10-12", { cards: 1, turns: 0, done: 0, xp: 50 }],
    ]);
    const stitches = cloth(days, ["2026-10-07"], "2026-10-11", 2);
    expect(stitches).toHaveLength(14);
    expect(stitches[0]?.day).toBe("2026-09-28");
    const byDay = new Map(stitches.map((s) => [s.day, s]));
    expect(byDay.get("2026-10-05")?.tone).toBe(4);
    expect(byDay.get("2026-10-06")?.tone).toBe(1);
    expect(byDay.get("2026-10-07")?.tone).toBe(-1);
    expect(byDay.get("2026-10-08")?.tone).toBe(0);
    // Days after today stay blank.
    expect(cloth(days, [], "2026-10-11", 3).find((s) => s.day === "2026-10-12")).toBeUndefined();
    expect(cloth(new Map(), [], "2026-10-11", 1).every((s) => s.tone === 0)).toBe(true);
  });
});

describe("records and weekXp", () => {
  it("finds the biggest days, the fastest and cheapest ships, and most running at once", () => {
    const events = [
      ev("created", at(9), { card: "a" }),
      ev("created", at(9), { card: "b" }),
      ev("created", at(10), { card: "c" }),
      ev("done", at(9, 12), { card: "a", cost: 0.4 }),
      ev("done", at(9, 10) + 30_000, { card: "b", cost: 0 }),
      ev("done", at(10, 11), { card: "c", cost: 2 }),
      ev("done", at(10, 12), { card: "unknown" }),
      ev("done", at(9, 10) + 5 * 60_000, { card: "a", id: "done:a" }),
      ev("start", at(10), { running: 4 }),
    ];
    const r = records(events, tallyDays(events, same));
    expect(r.biggestDay).toEqual({ day: "2026-10-09", cards: 2 });
    expect(r.mostShipped).toEqual({ day: "2026-10-09", done: 3 });
    expect(r.maxRunning).toBe(4);
    expect(r.fastest).toBe(60 * 60 * 1000);
    expect(r.cheapest).toBe(0.4);
  });

  it("is empty for an empty log", () => {
    expect(records([], new Map())).toEqual({ biggestDay: null, mostShipped: null, maxRunning: 0, fastest: null, cheapest: null });
  });

  it("sums this week's XP up to today", () => {
    const days = new Map([
      ["2026-10-04", { cards: 0, turns: 0, done: 0, xp: 99 }],
      ["2026-10-05", { cards: 0, turns: 0, done: 0, xp: 10 }],
      ["2026-10-11", { cards: 0, turns: 0, done: 0, xp: 5 }],
    ]);
    expect(weekXp(days, "2026-10-11")).toBe(15);
  });

  it("counts this week's shipped cards up to today", () => {
    const days = new Map([
      ["2026-10-04", { cards: 0, turns: 0, done: 9, xp: 0 }],
      ["2026-10-05", { cards: 0, turns: 0, done: 2, xp: 0 }],
      ["2026-10-11", { cards: 0, turns: 0, done: 1, xp: 0 }],
    ]);
    expect(weekShipped(days, "2026-10-11")).toBe(3);
  });
});
