import { describe, expect, it } from "vitest";
import { clock, cronFor, describeCron, isValidCron, nextRun, nextRuns, parseCron, presetOf, type CronPick } from "./cron-schedule";

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
// Mon 26 Oct 2026, 00:30 local.
const NOW = at(2026, 10, 26, 0, 30);
const pick = (p: Partial<CronPick>): CronPick => ({ preset: "daily", hour: 9, minute: 0, days: [1], dom: 1, ...p });

describe("parseCron", () => {
  it("reads lists, ranges, steps and Sunday as 7", () => {
    const f = parseCron("*/15 9-11 1,15 * 7");
    expect([...f.minute]).toEqual([0, 15, 30, 45]);
    expect([...f.hour]).toEqual([9, 10, 11]);
    expect([...f.dom]).toEqual([1, 15]);
    expect(f.month.size).toBe(12);
    expect([...f.dow]).toEqual([0]);
    expect(f.domAny).toBe(false);
    expect(f.dowAny).toBe(false);
  });

  it("reads a start with a step as running to the end of the range", () => {
    expect([...parseCron("50/5 * * * *").minute]).toEqual([50, 55]);
  });

  it("says what's wrong", () => {
    expect(() => parseCron("0 9 * *")).toThrow(/five fields/);
    expect(() => parseCron("x 9 * * *")).toThrow(/isn't a valid minute/);
    expect(() => parseCron("0 24 * * *")).toThrow(/out of range for the hour/);
    expect(() => parseCron("0 9 5-1 * *")).toThrow(/out of range/);
    expect(() => parseCron("*/0 9 * * *")).toThrow(/out of range/);
  });

  it("isValidCron", () => {
    expect(isValidCron("0 9 * * 1-5")).toBe(true);
    expect(isValidCron("nope")).toBe(false);
  });
});

describe("nextRun", () => {
  it("weekdays at 9:00 from a Monday night runs Monday morning, then skips the weekend", () => {
    expect(nextRun("0 9 * * 1-5", NOW)).toBe(at(2026, 10, 26, 9));
    expect(nextRun("0 9 * * 1-5", at(2026, 10, 30, 9))).toBe(at(2026, 11, 2, 9));
  });

  it("is strictly after, to the minute", () => {
    expect(nextRun("30 0 * * *", NOW)).toBe(at(2026, 10, 27, 0, 30));
    expect(nextRun("* * * * *", NOW + 20_000)).toBe(NOW + 60_000);
  });

  it("matches either day field when both are restricted, like cron", () => {
    // The 1st, or any Friday: Fri 30 Oct comes first.
    expect(nextRun("0 9 1 * 5", NOW)).toBe(at(2026, 10, 30, 9));
    // Day of month only.
    expect(nextRun("0 10 1 * *", NOW)).toBe(at(2026, 11, 1, 10));
  });

  it("skips months the cron leaves out", () => {
    expect(nextRun("0 0 1 3 *", NOW)).toBe(at(2027, 3, 1));
  });

  it("gives undefined for a date that never comes", () => {
    expect(nextRun("0 0 30 2 *", NOW)).toBeUndefined();
  });
});

describe("nextRuns", () => {
  it("lists the next few", () => {
    expect(nextRuns("0 9 * * *", NOW, 3)).toEqual([at(2026, 10, 26, 9), at(2026, 10, 27, 9), at(2026, 10, 28, 9)]);
  });

  it("stops when the cron never fires", () => {
    expect(nextRuns("0 0 30 2 *", NOW, 3)).toEqual([]);
  });
});

describe("cronFor and presetOf", () => {
  it("round-trips every preset", () => {
    const cases: [CronPick, string][] = [
      [pick({ preset: "hourly", minute: 15 }), "15 * * * *"],
      [pick({ preset: "daily", hour: 7, minute: 30 }), "30 7 * * *"],
      [pick({ preset: "weekdays", days: [1, 2, 3, 4, 5] }), "0 9 * * 1-5"],
      [pick({ preset: "weekly", days: [4, 1] }), "0 9 * * 1,4"],
      [pick({ preset: "monthly", hour: 10, dom: 1 }), "0 10 1 * *"],
    ];
    for (const [p, expr] of cases) {
      expect(cronFor(p)).toBe(expr);
      expect(presetOf(expr)).toMatchObject({ preset: p.preset, minute: p.minute });
    }
    expect(presetOf("0 9 * * 1,4").days).toEqual([1, 4]);
    expect(presetOf("0 10 1 * *").dom).toBe(1);
  });

  it("weekly with no days picked falls back to Monday", () => {
    expect(cronFor(pick({ preset: "weekly", days: [] }))).toBe("0 9 * * 1");
  });

  it("custom keeps the cron as typed", () => {
    expect(cronFor(pick({ preset: "custom", expr: " */5 * * * * " }))).toBe("*/5 * * * *");
    expect(cronFor(pick({ preset: "custom" }))).toBe("");
  });

  it("reads anything the presets can't say as custom", () => {
    for (const expr of ["bad", "*/5 * * * *", "0 9 * 6 *", "0 */2 * * *", "0 9 1 * 1", "0 9 1-3 * *"]) {
      expect(presetOf(expr)).toMatchObject({ preset: "custom", expr });
    }
  });
});

describe("describeCron", () => {
  it("speaks plainly", () => {
    expect(describeCron("15 * * * *")).toBe("every hour at :15");
    expect(describeCron("30 7 * * *")).toBe("every day at 7:30");
    expect(describeCron("0 9 * * 1-5")).toBe("weekdays at 9:00");
    expect(describeCron("0 9 * * 1")).toBe("Mondays at 9:00");
    expect(describeCron("0 9 * * 1,3,5")).toBe("Mondays, Wednesdays and Fridays at 9:00");
    expect(describeCron("0 9 * * 0,1,2,3,4,5,6")).toBe("every day at 9:00");
    expect(describeCron("0 10 1 * *")).toBe("on the 1st of each month at 10:00");
    expect(describeCron("0 10 2 * *")).toBe("on the 2nd of each month at 10:00");
    expect(describeCron("0 10 3 * *")).toBe("on the 3rd of each month at 10:00");
    expect(describeCron("0 10 11 * *")).toBe("on the 11th of each month at 10:00");
    expect(describeCron("0 10 20 * *")).toBe("on the 20th of each month at 10:00");
    expect(describeCron(" */5 * * * * ")).toBe("cron */5 * * * *");
  });

  it("clock pads the minutes", () => {
    expect(clock(9, 5)).toBe("9:05");
  });
});
