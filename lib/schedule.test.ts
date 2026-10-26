import { describe, expect, it } from "vitest";
import { RESET_GRACE_MS, addScheduled, dueMessage, formatAt, nextFiveHourReset, nextWeeklyReset, planResets, sendLaterOptions, sendsWhen, toLocalInput } from "./schedule";
import type { Card } from "./types";

const NOW = new Date(2026, 9, 10, 22, 30).getTime();

const card = (over: Partial<Card> = {}): Card =>
  ({ id: "c", title: "t", prompt: "", cwd: "/tmp", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0, ...over });

const withReset = (at: number, over: Partial<Card> = {}) => card({ stats: { fiveHour: { used: 90, resetsAt: at / 1000 } }, ...over });
const withWeekly = (at: number, used: number, over: Partial<Card> = {}) => card({ stats: { sevenDay: { used, resetsAt: at / 1000 } }, ...over });

describe("nextFiveHourReset", () => {
  it("is undefined when no thread has seen a reset", () => {
    expect(nextFiveHourReset([card(), card({ stats: {} })], NOW)).toBeUndefined();
  });

  it("ignores resets already past", () => {
    expect(nextFiveHourReset([withReset(NOW - 60_000)], NOW)).toBeUndefined();
  });

  it("takes the latest reset still ahead", () => {
    const soon = NOW + 3600_000;
    const later = NOW + 2 * 3600_000;
    expect(nextFiveHourReset([withReset(soon), withReset(later), withReset(NOW - 1)], NOW)).toBe(later);
  });

  it("keeps the latest when another thread's reset is earlier than it", () => {
    const soon = NOW + 3600_000;
    const later = NOW + 2 * 3600_000;
    // The second card's window resets before the first's, so it doesn't move the answer.
    expect(nextFiveHourReset([withReset(later), withReset(soon)], NOW)).toBe(later);
  });

  it("skips puku threads", () => {
    expect(nextFiveHourReset([withReset(NOW + 3600_000, { backend: "puku" })], NOW)).toBeUndefined();
  });
});

describe("nextWeeklyReset and planResets", () => {
  it("is undefined when no thread has seen a weekly reset still ahead", () => {
    expect(nextWeeklyReset([card(), withWeekly(NOW - 1, 100)], NOW)).toBeUndefined();
  });

  it("takes the latest weekly reset and the highest share used at it", () => {
    const later = NOW + 3 * 86400_000;
    const resets = [withWeekly(NOW + 86400_000, 100), withWeekly(later, 80), withWeekly(later, 95), withWeekly(later, 60)];
    expect(nextWeeklyReset(resets, NOW)).toEqual({ at: later, used: 95 });
  });

  it("skips puku threads", () => {
    expect(nextWeeklyReset([withWeekly(NOW + 86400_000, 100, { backend: "puku" })], NOW)).toBeUndefined();
  });

  it("gathers both resets", () => {
    const fiveHour = NOW + 3600_000;
    const weekly = NOW + 86400_000;
    expect(planResets([withReset(fiveHour), withWeekly(weekly, 50)], NOW)).toEqual({ fiveHour, weekly: { at: weekly, used: 50 } });
  });
});

describe("sendLaterOptions", () => {
  const fiveHour = NOW + 3600_000;
  const weeklyAt = NOW + 2 * 86400_000;
  const labels = (options: { label: string }[]) => options.map((o) => o.label);

  it("puts the 5-hour reset first on a Claude thread, a minute after it", () => {
    const [first] = sendLaterOptions("claude", { fiveHour }, NOW);
    expect(first).toEqual({ label: "At the 5-hour reset", at: fiveHour + RESET_GRACE_MS });
  });

  it("leaves the resets out on puku, or when they aren't known", () => {
    expect(labels(sendLaterOptions("puku", { fiveHour, weekly: { at: weeklyAt, used: 100 } }, NOW))).toEqual(["In 1 hour", "Tomorrow morning"]);
    expect(sendLaterOptions("claude", {}, NOW)[0]?.label).toBe("In 1 hour");
  });

  it("leaves the weekly reset out while the weekly window has room", () => {
    expect(labels(sendLaterOptions("claude", { fiveHour, weekly: { at: weeklyAt, used: 89 } }, NOW))).toEqual(["At the 5-hour reset", "In 1 hour", "Tomorrow morning"]);
  });

  it("offers the weekly reset after the 5-hour one when the weekly window is close to used up", () => {
    const options = sendLaterOptions("claude", { fiveHour, weekly: { at: weeklyAt, used: 90 } }, NOW);
    expect(labels(options)).toEqual(["At the 5-hour reset", "At the weekly reset", "In 1 hour", "Tomorrow morning"]);
    expect(options[1]?.at).toBe(weeklyAt + RESET_GRACE_MS);
  });

  it("makes the weekly reset the default when the weekly window is used up", () => {
    const options = sendLaterOptions("claude", { fiveHour, weekly: { at: weeklyAt, used: 100 } }, NOW);
    expect(options[0]).toEqual({ label: "At the weekly reset", at: weeklyAt + RESET_GRACE_MS });
    expect(options[1]?.label).toBe("At the 5-hour reset");
  });

  it("offers the weekly reset even when the 5-hour reset isn't known", () => {
    expect(labels(sendLaterOptions("claude", { weekly: { at: weeklyAt, used: 100 } }, NOW))).toEqual(["At the weekly reset", "In 1 hour", "Tomorrow morning"]);
  });

  it("offers tomorrow at 9am", () => {
    const tomorrow = sendLaterOptions("claude", {}, NOW)[1];
    expect(tomorrow?.at).toBe(new Date(2026, 9, 11, 9, 0).getTime());
  });
});

describe("addScheduled and dueMessage", () => {
  it("keeps the soonest first", () => {
    const list = addScheduled([{ id: "b", text: "b", at: NOW + 2 }], { id: "a", text: "a", at: NOW + 1 });
    expect(list.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("starts a list for a card that has none", () => {
    expect(addScheduled(undefined, { id: "a", text: "a", at: NOW })).toEqual([{ id: "a", text: "a", at: NOW }]);
  });

  it("finds the message whose time has come", () => {
    const scheduled = [{ id: "a", text: "hi", at: NOW }];
    expect(dueMessage(card({ scheduled }), NOW - 1)).toBeUndefined();
    expect(dueMessage(card({ scheduled }), NOW)?.id).toBe("a");
    expect(dueMessage(card(), NOW)).toBeUndefined();
  });
});

describe("sendsWhen", () => {
  it("names a held message's moment, else its time", () => {
    const at = new Date(2026, 9, 10, 23, 41).getTime();
    expect(sendsWhen({ id: "a", text: "x", at, afterRestart: true }, NOW)).toBe("after restart");
    expect(sendsWhen({ id: "b", text: "x", at, afterTurn: true }, NOW)).toBe("after this turn");
    expect(sendsWhen({ id: "c", text: "x", at }, NOW)).toBe("11:41pm");
  });
});

describe("formatAt and toLocalInput", () => {
  it("shows just the time today, the weekday otherwise", () => {
    expect(formatAt(new Date(2026, 9, 10, 23, 41).getTime(), NOW)).toBe("11:41pm");
    expect(formatAt(new Date(2026, 9, 11, 9, 0).getTime(), NOW)).toBe("sun 9:00am");
  });

  it("writes a datetime-local value", () => {
    expect(toLocalInput(new Date(2026, 0, 2, 3, 4).getTime())).toBe("2026-01-02T03:04");
  });
});

describe("messages held for a slot", () => {
  const base = { id: "c", title: "c", prompt: "", cwd: "/", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0 } as const;

  it("aren't due on a timer, and a timed one behind them still is", () => {
    const held = { id: "h", text: "held", at: 1, forSlot: true };
    expect(dueMessage({ ...base, scheduled: [held] }, 100)).toBeUndefined();
    expect(dueMessage({ ...base, scheduled: [held, { id: "t", text: "t", at: 50 }] }, 100)?.id).toBe("t");
  });

  it("read as waiting for a slot", () => {
    expect(sendsWhen({ id: "h", text: "held", at: 1, forSlot: true })).toBe("when a slot frees");
  });
});
