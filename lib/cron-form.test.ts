import { describe, expect, it } from "vitest";
import { exprOf, formOf, inputOf, midnight, monthGrid, newForm, PRESETS, readback, runLabel, sameDay, timeValue, toggleDay, untilNext, upcoming, withTime, type CronForm } from "./cron-form";
import type { CronPick } from "./cron-schedule";

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
// Mon 26 Oct 2026, 08:00 local.
const NOW = new Date(2026, 9, 26, 8, 0).getTime();
const DAY = 86_400_000;

const pick = (over: Partial<CronPick> = {}): CronPick => ({ preset: "daily", hour: 9, minute: 0, days: [1], dom: 1, ...over });
const form = (over: Partial<CronForm> = {}): CronForm => ({ prompt: "do it", mode: "fresh", pick: pick(), start: midnight(NOW), ...over });

describe("newForm", () => {
  it("starts on weekdays at 9:00, today, with the message it repeats", () => {
    const f = newForm("do it", "fork", NOW);
    expect(f).toEqual({ prompt: "do it", mode: "fork", pick: { preset: "weekdays", hour: 9, minute: 0, days: [1], dom: 26 }, start: midnight(NOW) });
    expect(f.start).toBe(new Date(2026, 9, 26).getTime());
  });
});

describe("formOf", () => {
  it("reads an existing cron back into the form, with its schedule and start", () => {
    const f = formOf({ prompt: "p", mode: "fork", expr: "0 9 * * 1-5", startsAt: at(2026, 10, 27, 13, 45), createdAt: at(2026, 10, 26) });
    expect(f.prompt).toBe("p");
    expect(f.mode).toBe("fork");
    expect(f.pick).toMatchObject({ preset: "weekdays", hour: 9, minute: 0, days: [1, 2, 3, 4, 5] });
    expect(f.start).toBe(new Date(2026, 9, 27).getTime());
    expect(f.end).toBeUndefined();
  });

  it("falls back to the created day when the cron has no start, and keeps the end day", () => {
    const f = formOf({ prompt: "p", mode: "fresh", expr: "0 9 * * *", createdAt: at(2026, 10, 26, 17, 3), endsAt: at(2026, 10, 30, 22, 0) });
    expect(f.start).toBe(new Date(2026, 9, 26).getTime());
    expect(f.end).toBe(new Date(2026, 9, 30).getTime());
  });
});

describe("withTime", () => {
  it("takes the hour and minute", () => {
    expect(withTime(pick(), "14:05")).toMatchObject({ hour: 14, minute: 5 });
    // A one-digit hour is fine.
    expect(withTime(pick(), "9:00")).toMatchObject({ hour: 9, minute: 0 });
  });

  it("clamps an hour and minute that are too big", () => {
    expect(withTime(pick(), "99:99")).toMatchObject({ hour: 23, minute: 59 });
  });

  it("leaves the pick alone for anything that isn't a time", () => {
    const p = pick();
    expect(withTime(p, "")).toBe(p);
    expect(withTime(p, "9")).toBe(p);
    expect(withTime(p, "9:0")).toBe(p);
    expect(withTime(p, "half nine")).toBe(p);
  });
});

describe("timeValue", () => {
  it("is the time as the input shows it", () => {
    expect(timeValue(pick({ hour: 9, minute: 5 }))).toBe("09:05");
    expect(timeValue(pick({ hour: 23, minute: 59 }))).toBe("23:59");
  });
});

describe("toggleDay", () => {
  it("adds a day and keeps them in order", () => {
    expect(toggleDay(pick({ days: [1] }), 3).days).toEqual([1, 3]);
    expect(toggleDay(pick({ days: [3] }), 1).days).toEqual([1, 3]);
  });

  it("removes a day that's there", () => {
    expect(toggleDay(pick({ days: [1, 3, 5] }), 3).days).toEqual([1, 5]);
  });

  it("keeps the last day when the last one is taken off", () => {
    const p = pick({ days: [2] });
    expect(toggleDay(p, 2).days).toEqual([2]);
  });
});

describe("exprOf", () => {
  it("makes the cron string for the preset", () => {
    expect(exprOf(form({ pick: pick({ preset: "daily", hour: 9, minute: 0 }) })).expr).toBe("0 9 * * *");
    expect(exprOf(form({ pick: pick({ preset: "weekdays", hour: 8, minute: 30 }) })).expr).toBe("30 8 * * 1-5");
    expect(exprOf(form({ pick: pick({ preset: "weekly", days: [1, 3] }) })).expr).toBe("0 9 * * 1,3");
    expect(exprOf(form({ pick: pick({ preset: "monthly", dom: 12 }) })).expr).toBe("0 9 12 * *");
    expect(exprOf(form({ pick: pick({ preset: "hourly", minute: 15 }) })).expr).toBe("15 * * * *");
  });

  it("says what's wrong with a custom schedule", () => {
    const bad = exprOf(form({ pick: pick({ preset: "custom", expr: "nope" }) }));
    expect(bad.expr).toBe("nope");
    expect(bad.error).toMatch(/five fields/);
    const out = exprOf(form({ pick: pick({ preset: "custom", expr: "0 99 * * *" }) }));
    expect(out.error).toMatch(/out of range/);
  });
});

describe("upcoming", () => {
  it("lists the runs to come", () => {
    const runs = upcoming(form({ pick: pick({ preset: "daily", hour: 9, minute: 0 }) }), NOW, 3);
    expect(runs).toHaveLength(3);
    expect(runs[0]).toBe(new Date(2026, 9, 26, 9, 0).getTime());
    expect(runs[1]).toBe(new Date(2026, 9, 27, 9, 0).getTime());
    expect(runs.every((r) => r > NOW)).toBe(true);
  });

  it("has no runs when the schedule is broken", () => {
    expect(upcoming(form({ pick: pick({ preset: "custom", expr: "nope" }) }), NOW, 3)).toEqual([]);
  });

  it("keeps only the runs on or before the end day", () => {
    const end = new Date(2026, 9, 28).getTime();
    const runs = upcoming(form({ pick: pick({ preset: "daily", hour: 9, minute: 0 }), end }), NOW, 10);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((r) => r < end + DAY)).toBe(true);
    expect(runs.some((r) => r >= end + DAY)).toBe(false);
  });

  it("starts from the start day when the form starts later than now", () => {
    const start = new Date(2026, 9, 29).getTime();
    const runs = upcoming(form({ pick: pick({ preset: "daily", hour: 9, minute: 0 }), start }), NOW, 2);
    expect(runs[0]).toBe(new Date(2026, 9, 29, 9, 0).getTime());
  });
});

describe("readback", () => {
  it("says the schedule in words", () => {
    expect(readback(form({ pick: pick({ preset: "daily", hour: 9, minute: 0 }) }))).toBe("every day at 9:00");
    expect(readback(form({ pick: pick({ preset: "weekdays", hour: 9, minute: 0 }) }))).toBe("weekdays at 9:00");
    expect(readback(form({ pick: pick({ preset: "hourly", minute: 15 }) }))).toBe("every hour at :15");
  });

  it("shows the error when the schedule is broken", () => {
    expect(readback(form({ pick: pick({ preset: "custom", expr: "nope" }) }))).toMatch(/five fields/);
  });
});

describe("inputOf", () => {
  it("asks for a prompt", () => {
    expect(inputOf(form({ prompt: "   " }), {}, NOW)).toEqual({ error: "Write what each run should do." });
  });

  it("says the schedule isn't a cron", () => {
    expect(inputOf(form({ pick: pick({ preset: "custom", expr: "nope" }) }), {}, NOW)).toEqual({ error: expect.stringMatching(/five fields/) as string });
  });

  it("says it ends before it starts", () => {
    const start = new Date(2026, 9, 26).getTime();
    const out = inputOf(form({ start, end: start - DAY }), {}, NOW);
    expect(out).toEqual({ error: "It ends before it starts." });
  });

  it("leaves out the start when the cron starts today, and sends it when it starts later", () => {
    const today = inputOf(form({ start: midnight(NOW) }), {}, NOW) as { startsAt?: number };
    expect(today.startsAt).toBeUndefined();
    const later = inputOf(form({ start: midnight(NOW + 5 * DAY) }), {}, NOW) as { startsAt?: number };
    expect(later.startsAt).toBe(midnight(NOW + 5 * DAY));
  });

  it("sends the whole last day as the end", () => {
    const end = new Date(2026, 9, 30).getTime();
    const out = inputOf(form({ end }), {}, NOW) as { endsAt?: number };
    expect(out.endsAt).toBe(end + DAY - 1);
  });

  it("keeps what it was given and trims the prompt", () => {
    const out = inputOf(form({ prompt: "  go  " }), { name: "Digest", cardId: "c1" }, NOW);
    expect(out).toMatchObject({ prompt: "go", expr: "0 9 * * *", mode: "fresh", name: "Digest", cardId: "c1" });
  });
});

describe("monthGrid", () => {
  it("pads the first week so Monday comes first", () => {
    // Oct 2026 starts on a Thursday: three days of padding before the 1st.
    const grid = monthGrid(2026, 9);
    expect(grid[0]?.slice(0, 3)).toEqual([null, null, null]);
    expect(grid[0]?.[3]).toBe(new Date(2026, 9, 1).getTime());
  });

  it("pads the last week", () => {
    const grid = monthGrid(2026, 9);
    expect(grid.every((week) => week.length === 7)).toBe(true);
    const flat = grid.flat();
    expect(flat.filter(Boolean)).toHaveLength(31);
    expect(flat[flat.length - 1]).toBe(null);
  });

  it("pads six days when the month starts on a Sunday, and one when it starts on a Tuesday", () => {
    // Nov 2026 starts on a Sunday -> six days of padding; Dec 2026 starts on a Tuesday -> one.
    expect(monthGrid(2026, 10)[0]?.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(monthGrid(2026, 10)[0]?.[6]).toBe(new Date(2026, 10, 1).getTime());
    expect(monthGrid(2026, 11)[0]?.[0]).toBe(null);
    expect(monthGrid(2026, 11)[0]?.[1]).toBe(new Date(2026, 11, 1).getTime());
  });
});

describe("sameDay", () => {
  it("is true for two times on the same day", () => {
    expect(sameDay(new Date(2026, 9, 26, 1, 0).getTime(), new Date(2026, 9, 26, 23, 0).getTime())).toBe(true);
    expect(sameDay(new Date(2026, 9, 26, 23, 59).getTime(), new Date(2026, 9, 27, 0, 0).getTime())).toBe(false);
  });
});

describe("runLabel", () => {
  it("says today", () => {
    expect(runLabel(new Date(2026, 9, 26, 9, 5).getTime(), NOW)).toBe("today 9:05");
  });

  it("says tomorrow", () => {
    expect(runLabel(new Date(2026, 9, 27, 9, 0).getTime(), NOW)).toBe("tomorrow 9:00");
  });

  it("gives the day and the time for any other day", () => {
    expect(runLabel(new Date(2026, 9, 30, 14, 30).getTime(), NOW)).toBe("Fri 30 Oct, 14:30");
  });
});

describe("untilNext", () => {
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;

  it("counts the minutes until the next run", () => {
    expect(untilNext(NOW + 5 * MINUTE, NOW)).toBe("in 5m");
    expect(untilNext(NOW + 59 * MINUTE, NOW)).toBe("in 59m");
  });

  it("never says less than a minute", () => {
    expect(untilNext(NOW, NOW)).toBe("in 1m");
    expect(untilNext(NOW + MINUTE / 2, NOW)).toBe("in 1m");
    expect(untilNext(NOW - 10 * MINUTE, NOW)).toBe("in 1m");
  });

  it("counts the hours once it is an hour or more away", () => {
    expect(untilNext(NOW + HOUR, NOW)).toBe("in 1h");
    expect(untilNext(NOW + 3 * HOUR, NOW)).toBe("in 3h");
    // 47 hours is still hours; 48 hours and over becomes days.
    expect(untilNext(NOW + 47 * HOUR, NOW)).toBe("in 47h");
  });

  it("counts the days from 48 hours on", () => {
    expect(untilNext(NOW + 48 * HOUR, NOW)).toBe("in 2d");
    expect(untilNext(NOW + 3 * DAY, NOW)).toBe("in 3d");
  });
});

describe("PRESETS", () => {
  it("offers every preset the popover shows", () => {
    expect(PRESETS.map((p) => p.id)).toEqual(["hourly", "daily", "weekdays", "weekly", "monthly", "custom"]);
  });
});
