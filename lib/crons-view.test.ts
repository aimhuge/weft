import { describe, expect, it } from "vitest";
import { activeCount, cronSummary, cronsTitle, runTone, sortCrons, TONE_CLASS, TONE_LABEL } from "./crons-view";
import type { Cron, CronRun } from "./cron-types";

const cron = (over: Partial<Cron> = {}): Cron => ({
  id: "c1",
  name: "Daily digest",
  prompt: "do the thing",
  expr: "0 9 * * *",
  mode: "fresh",
  cwd: "/tmp",
  backend: "claude",
  permissionMode: "default",
  enabled: true,
  by: "you",
  count: 0,
  runs: [],
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const run = (over: Partial<CronRun> = {}): CronRun => ({ cardId: "card1", n: 1, at: 1000, ...over });

describe("sortCrons", () => {
  it("puts the ones that will run soonest first", () => {
    const soon = cron({ id: "soon", nextAt: 100 });
    const later = cron({ id: "later", name: "Later", nextAt: 200 });
    expect(sortCrons([later, soon]).map((c) => c.id)).toEqual(["soon", "later"]);
  });

  it("puts the ones with no next run last", () => {
    const none = cron({ id: "none", name: "None" });
    const off = cron({ id: "off", name: "Off", enabled: false });
    const soon = cron({ id: "soon", nextAt: 100 });
    expect(sortCrons([none, off, soon]).map((c) => c.id)).toEqual(["soon", "none", "off"]);
  });

  it("breaks a tie on the next run by name", () => {
    const a = cron({ id: "a", name: "Apple", nextAt: 100 });
    const b = cron({ id: "b", name: "Banana", nextAt: 100 });
    expect(sortCrons([b, a]).map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("doesn't change the list it was given", () => {
    const list = [cron({ id: "b", nextAt: 200 }), cron({ id: "a", nextAt: 100 })];
    sortCrons(list);
    expect(list.map((c) => c.id)).toEqual(["b", "a"]);
  });
});

describe("activeCount", () => {
  it("counts the crons that will run again", () => {
    expect(activeCount([])).toBe(0);
    expect(activeCount([cron({ nextAt: 100 }), cron({ id: "c2", enabled: false, nextAt: 200 })])).toBe(1);
    // Enabled, but its last run has passed and there's no next one.
    expect(activeCount([cron({ enabled: true })])).toBe(0);
  });
});

describe("cronsTitle", () => {
  it("says what to do when there are none", () => {
    expect(cronsTitle([])).toBe("Crons: run a thread again on a schedule (⏰ in a thread's header)");
  });

  it("counts them when they're all on", () => {
    expect(cronsTitle([cron({ nextAt: 1 }), cron({ id: "c2", name: "B", nextAt: 2 })])).toBe("Crons: 2 on");
  });

  it("counts the ones that are off too", () => {
    expect(cronsTitle([cron({ nextAt: 1 }), cron({ id: "c2", name: "B", enabled: false })])).toBe("Crons: 1 on, 1 off");
  });
});

describe("runTone", () => {
  it("is failed when the run itself failed", () => {
    expect(runTone(run({ error: "no card" }), [{ id: "card1", column: "running" }])).toBe("failed");
  });

  it("is gone when the card was deleted", () => {
    expect(runTone(run(), [])).toBe("gone");
    expect(runTone(run(), [{ id: "other", column: "running" }])).toBe("gone");
  });

  it("is failed when the card failed", () => {
    expect(runTone(run(), [{ id: "card1", column: "running", error: "boom" }])).toBe("failed");
  });

  it("is running, needs_you, done or review from the card's column", () => {
    expect(runTone(run(), [{ id: "card1", column: "running" }])).toBe("running");
    expect(runTone(run(), [{ id: "card1", column: "needs_you" }])).toBe("needs_you");
    expect(runTone(run(), [{ id: "card1", column: "done" }])).toBe("done");
    expect(runTone(run(), [{ id: "card1", column: "review" }])).toBe("review");
    expect(runTone(run(), [{ id: "card1", column: "backlog" }])).toBe("review");
  });
});

describe("cronSummary", () => {
  it("says a fresh thread makes a fresh thread", () => {
    expect(cronSummary(cron())).toBe("every day at 9:00 · fresh thread");
  });

  it("names the source a fork continues", () => {
    expect(cronSummary(cron({ mode: "fork" }), "The old thread")).toBe("every day at 9:00 · forks “The old thread”");
    // With no title, it falls back to the cron's own name.
    expect(cronSummary(cron({ mode: "fork", name: "Digest" }))).toBe("every day at 9:00 · forks “Digest”");
  });

  it("says a thread made it", () => {
    expect(cronSummary(cron({ by: "thread" }))).toBe("every day at 9:00 · fresh thread · made by a thread");
    expect(cronSummary(cron({ mode: "fork", by: "thread" }), "Src")).toBe("every day at 9:00 · forks “Src” · made by a thread");
  });
});

describe("TONE_CLASS / TONE_LABEL", () => {
  it("has a class and a label for every tone", () => {
    expect(Object.keys(TONE_CLASS).sort()).toEqual(["done", "failed", "gone", "needs_you", "review", "running"]);
    expect(Object.keys(TONE_LABEL).sort()).toEqual(["done", "failed", "gone", "needs_you", "review", "running"]);
  });
});
