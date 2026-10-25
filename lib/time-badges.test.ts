import { describe, expect, it } from "vitest";
import type { ActivityEvent, Records } from "./game";
import type { GameFacts } from "./game-badges";
import { TIME_DEFS } from "./time-badges";

const noRecords: Records = { biggestDay: null, mostShipped: null, maxRunning: 0, fastest: null, cheapest: null };

function facts(overrides: Partial<GameFacts> = {}): GameFacts {
  return { events: [], bestStreak: 0, records: noRecords, projects: [], projectCount: 0, refactors: 0, climbed: false, ...overrides };
}

const local = (d: number, h = 12, mi = 0, month = 9) => new Date(2026, month, d, h, mi).getTime();
// A live event: its id must not look like a backfilled Done ("done:<card>").
const ev = (kind: ActivityEvent["kind"], at: number, extra: Partial<ActivityEvent> = {}): ActivityEvent =>
  ({ id: `${kind}-${at}-${extra.card ?? ""}`, kind, at, ...extra });
const test = (id: string) => TIME_DEFS.find((d) => d.id === id)!.test;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// A card created and shipped on the same local day, with the given span.
const quickShip = (card: string, start: number, ms: number) => [
  ev("created", start, { card }),
  ev("done", start + ms, { card }),
];

describe("TIME_DEFS", () => {
  it("holds every badge the family asks for", () => {
    expect(TIME_DEFS.map((d) => d.id)).toEqual([
      "blink", "sprinter", "assembly-line", "same-day", "better-late",
      "shipped-1000", "shipped-2500", "turns-1k", "turns-10k", "turns-100k", "marathon", "one-shot",
      "weekend-warrior", "living-dangerously", "witching-hour", "dawn-to-dusk", "pi-day", "new-year", "spooky",
      "holiday-shift", "four-seasons", "leap",
    ]);
    expect(new Set(TIME_DEFS.map((d) => d.id)).size).toBe(TIME_DEFS.length);
    expect(TIME_DEFS.map((d) => d.group)).toEqual([
      "Speed", "Speed", "Speed", "Speed", "Speed",
      "Milestones", "Milestones", "Milestones", "Milestones", "Milestones", "Milestones", "Milestones",
      "Calendar", "Calendar", "Calendar", "Calendar", "Calendar", "Calendar", "Calendar", "Calendar", "Calendar", "Calendar",
    ]);
  });

  it("starts with everything locked", () => {
    for (const d of TIME_DEFS) expect(d.test(facts()).unlocked, d.id).toBe(false);
  });
});

describe("speed badges", () => {
  it("dates the first ship under five minutes", () => {
    const start = local(24, 9);
    expect(test("blink")(facts({ events: quickShip("a", start, 4 * MIN) }))).toEqual({ unlocked: true, at: start + 4 * MIN });
    expect(test("blink")(facts({ events: quickShip("a", start, 5 * MIN) }))).toEqual({ unlocked: false, at: undefined });
    expect(test("blink")(facts({ events: quickShip("a", start, 0) }))).toEqual({ unlocked: false, at: undefined });
  });

  it("takes the first of several short ships", () => {
    const start = local(24, 9);
    const events = [...quickShip("a", start, 4 * MIN), ...quickShip("b", start + HOUR, 2 * MIN)];
    expect(test("blink")(facts({ events }))).toEqual({ unlocked: true, at: start + 4 * MIN });
  });

  it("dates the first ship under fifteen minutes", () => {
    const start = local(24, 9);
    expect(test("sprinter")(facts({ events: quickShip("a", start, 14 * MIN) }))).toEqual({ unlocked: true, at: start + 14 * MIN });
    expect(test("sprinter")(facts({ events: quickShip("a", start, 15 * MIN) }))).toEqual({ unlocked: false, at: undefined });
  });

  it("ignores a ship with no creation or no card", () => {
    expect(test("blink")(facts({ events: [ev("done", local(24, 9, 1))] }))).toEqual({ unlocked: false, at: undefined });
    const start = local(24, 9);
    expect(test("blink")(facts({ events: [ev("created", start), ev("done", start + MIN)] }))).toEqual({ unlocked: false, at: undefined });
  });

  it("counts ten ships inside an hour", () => {
    const start = local(24, 9);
    const events = Array.from({ length: 10 }, (_, i) => ev("done", start + i * MIN, { card: `c${i}` }));
    expect(test("assembly-line")(facts({ events }))).toEqual({ unlocked: true, at: start + 9 * MIN });
    expect(test("assembly-line")(facts({ events: events.slice(0, 9) }))).toEqual({ unlocked: false, at: undefined });
  });

  it("does not count ships spread wider than an hour", () => {
    const start = local(24, 9);
    const events = Array.from({ length: 10 }, (_, i) => ev("done", start + i * 10 * MIN, { card: `c${i}` }));
    expect(test("assembly-line")(facts({ events }))).toEqual({ unlocked: false, at: undefined });
  });

  it("counts cards made and shipped on the same day", () => {
    const events = Array.from({ length: 20 }, (_, i) => {
      const start = local(24, 8, i);
      return [ev("created", start, { card: `c${i}` }), ev("done", local(24, 10, i), { card: `c${i}` })];
    }).flat();
    expect(test("same-day")(facts({ events }))).toEqual({ unlocked: true, at: local(24, 10, 19) });
    expect(test("same-day")(facts({ events: events.slice(0, 38) }))).toEqual({ unlocked: false, at: undefined });
  });

  it("leaves out a card shipped on another day", () => {
    const same = Array.from({ length: 20 }, (_, i) => {
      const start = local(24, 8, i);
      return [ev("created", start, { card: `c${i}` }), ev("done", local(24, 10, i), { card: `c${i}` })];
    }).flat();
    const events = [...same, ev("created", local(24, 22), { card: "late" }), ev("done", local(25, 1), { card: "late" })];
    expect(test("same-day")(facts({ events }))).toEqual({ unlocked: true, at: local(24, 10, 19) });
  });

  it("leaves out a ship with no card", () => {
    const events = [ev("done", local(24, 10), { id: "done-orphan" })];
    expect(test("same-day")(facts({ events }))).toEqual({ unlocked: false, at: undefined });
    expect(test("better-late")(facts({ events }))).toEqual({ unlocked: false, at: undefined });
  });

  it("dates the twentieth card of the earliest day that holds twenty", () => {
    const events = [23, 24].flatMap((day) =>
      Array.from({ length: 20 }, (_, i) => {
        const start = local(day, 8, i);
        return [ev("created", start, { card: `c${day}-${i}` }), ev("done", local(day, 10, i), { card: `c${day}-${i}` })];
      }).flat());
    expect(test("same-day")(facts({ events }))).toEqual({ unlocked: true, at: local(23, 10, 19) });
  });

  it("dates a ship whose card waited thirty days", () => {
    const start = local(24, 9, 0, 8);
    expect(test("better-late")(facts({ events: quickShip("a", start, 30 * DAY + 2 * HOUR) })))
      .toEqual({ unlocked: true, at: local(24, 11) });
    const near = local(24, 9, 0, 8);
    expect(test("better-late")(facts({ events: quickShip("a", near, 29 * DAY + 2 * HOUR) }))).toEqual({ unlocked: false, at: undefined });
  });
});

describe("milestone badges", () => {
  it("counts shipped cards and dates the thousandth", () => {
    const events = Array.from({ length: 1000 }, (_, i) => ev("done", 1000 + i, { card: `c${i}` }));
    expect(test("shipped-1000")(facts({ events }))).toEqual({ unlocked: true, at: 1999, have: 1000, need: 1000 });
    expect(test("shipped-2500")(facts({ events }))).toEqual({ unlocked: false, at: undefined, have: 1000, need: 2500 });
    expect(test("shipped-1000")(facts({ events: events.slice(0, 12) }))).toEqual({ unlocked: false, at: undefined, have: 12, need: 1000 });
  });

  it("crosses the turn ladders", () => {
    const events = [ev("turn", 10, { card: "a", turns: 600 }), ev("turn", 20, { card: "b", turns: 500 })];
    expect(test("turns-1k")(facts({ events }))).toEqual({ unlocked: true, at: 20, have: 1000, need: 1000 });
    expect(test("turns-10k")(facts({ events }))).toEqual({ unlocked: false, have: 1100, need: 10_000 });
    expect(test("turns-100k")(facts({ events }))).toEqual({ unlocked: false, have: 1100, need: 100_000 });
  });

  it("counts one turn when the event carries none", () => {
    expect(test("turns-1k")(facts({ events: [ev("turn", 10, { card: "a" })] }))).toEqual({ unlocked: false, have: 1, need: 1000 });
  });

  it("dates the turn event that gives one card a hundred turns", () => {
    const events = [ev("turn", 10, { card: "a", turns: 60 }), ev("turn", 20, { card: "b", turns: 80 }), ev("turn", 30, { card: "a", turns: 40 })];
    expect(test("marathon")(facts({ events }))).toEqual({ unlocked: true, at: 30, have: 100, need: 100 });
    expect(test("marathon")(facts({ events: events.slice(0, 2) }))).toEqual({ unlocked: false, have: 80, need: 100 });
    expect(test("marathon")(facts())).toEqual({ unlocked: false, have: 0, need: 100 });
  });

  it("counts one turn for an event that carries none", () => {
    const events = [ev("turn", 10, { card: "a" }), ev("turn", 20, { card: "a" })];
    expect(test("marathon")(facts({ events }))).toEqual({ unlocked: false, have: 2, need: 100 });
  });

  it("keeps a turn with no card under its own id", () => {
    const events = [ev("turn", 10, { id: "turn-orphan" })];
    expect(test("marathon")(facts({ events }))).toEqual({ unlocked: false, have: 1, need: 100 });
  });

  it("dates a ship whose card turned exactly once", () => {
    const start = local(24, 9);
    const events = [ev("created", start, { card: "a" }), ev("turn", start + HOUR, { card: "a" }), ev("done", start + 2 * HOUR, { card: "a" })];
    expect(test("one-shot")(facts({ events }))).toEqual({ unlocked: true, at: start + 2 * HOUR });
    const twice = [ev("created", start, { card: "a" }), ev("turn", start + HOUR, { card: "a" }),
      ev("turn", start + 90 * MIN, { card: "a" }), ev("done", start + 2 * HOUR, { card: "a" })];
    expect(test("one-shot")(facts({ events: twice }))).toEqual({ unlocked: false, at: undefined });
    const never = [ev("created", start, { card: "a" }), ev("done", start + 2 * HOUR, { card: "a" })];
    expect(test("one-shot")(facts({ events: never }))).toEqual({ unlocked: false, at: undefined });
  });

  it("ignores turns after the ship when looking for a one-shot", () => {
    const start = local(24, 9);
    const events = [
      ev("created", start, { card: "a" }), ev("turn", start + HOUR, { card: "a" }), ev("done", start + 2 * HOUR, { card: "a" }),
      ev("turn", start + 3 * HOUR, { card: "a" }),
    ];
    expect(test("one-shot")(facts({ events }))).toEqual({ unlocked: true, at: start + 2 * HOUR });
  });
});

describe("calendar badges", () => {
  it("dates the Sunday ship after a Saturday one", () => {
    const sat = local(24, 10);
    const sun = local(25, 11);
    expect(test("weekend-warrior")(facts({ events: [ev("done", sat, { card: "a" }), ev("done", sun, { card: "b" })] })))
      .toEqual({ unlocked: true, at: sun });
    expect(test("weekend-warrior")(facts({ events: [ev("done", sat, { card: "a" })] }))).toEqual({ unlocked: false, at: undefined });
    expect(test("weekend-warrior")(facts({ events: [ev("done", sun, { card: "b" })] }))).toEqual({ unlocked: false, at: undefined });
  });

  it("dates a Friday ship after five", () => {
    const late = local(23, 18);
    expect(test("living-dangerously")(facts({ events: [ev("done", late, { card: "a" })] }))).toEqual({ unlocked: true, at: late });
    const early = local(23, 16);
    expect(test("living-dangerously")(facts({ events: [ev("done", early, { card: "a" })] }))).toEqual({ unlocked: false, at: undefined });
  });

  it("dates a ship at three in the morning", () => {
    const at = local(24, 3, 30);
    expect(test("witching-hour")(facts({ events: [ev("done", at, { card: "a" })] }))).toEqual({ unlocked: true, at });
    const noon = local(24, 12);
    expect(test("witching-hour")(facts({ events: [ev("done", noon, { card: "a" })] }))).toEqual({ unlocked: false, at: undefined });
  });

  it("dates the event that stretches a day across fourteen hours", () => {
    const start = local(24, 6);
    const events = [ev("created", start, { card: "a" }), ev("turn", start + 14 * HOUR, { card: "a" })];
    expect(test("dawn-to-dusk")(facts({ events }))).toEqual({ unlocked: true, at: start + 14 * HOUR });
    const short = [ev("created", start, { card: "a" }), ev("turn", start + 13 * HOUR, { card: "a" })];
    expect(test("dawn-to-dusk")(facts({ events: short }))).toEqual({ unlocked: false, at: undefined });
  });

  it("counts only created, turn and done events in a day", () => {
    const start = local(24, 6);
    const events = [ev("start", start, { card: "a" }), ev("turn", start + 14 * HOUR, { card: "a" })];
    expect(test("dawn-to-dusk")(facts({ events }))).toEqual({ unlocked: false, at: undefined });
  });

  it("dates a ship at a quarter past three on Pi day", () => {
    const morning = new Date(2026, 2, 14, 3, 14).getTime();
    const evening = new Date(2026, 2, 14, 15, 14).getTime();
    expect(test("pi-day")(facts({ events: [ev("done", morning, { card: "a" })] }))).toEqual({ unlocked: true, at: morning });
    expect(test("pi-day")(facts({ events: [ev("done", evening, { card: "a" })] }))).toEqual({ unlocked: true, at: evening });
    const wrongTime = new Date(2026, 2, 14, 3, 15).getTime();
    expect(test("pi-day")(facts({ events: [ev("done", wrongTime, { card: "a" })] }))).toEqual({ unlocked: false, at: undefined });
    const wrongDay = new Date(2026, 2, 15, 3, 14).getTime();
    expect(test("pi-day")(facts({ events: [ev("done", wrongDay, { card: "a" })] }))).toEqual({ unlocked: false, at: undefined });
  });

  it("dates the fixed calendar days", () => {
    const newYear = new Date(2026, 0, 1, 12).getTime();
    const spooky = new Date(2026, 9, 31, 12).getTime();
    const holiday = new Date(2026, 11, 25, 12).getTime();
    const leap = new Date(2024, 1, 29, 12).getTime();
    expect(test("new-year")(facts({ events: [ev("done", newYear, { card: "a" })] }))).toEqual({ unlocked: true, at: newYear });
    expect(test("spooky")(facts({ events: [ev("done", spooky, { card: "a" })] }))).toEqual({ unlocked: true, at: spooky });
    expect(test("holiday-shift")(facts({ events: [ev("done", holiday, { card: "a" })] }))).toEqual({ unlocked: true, at: holiday });
    expect(test("leap")(facts({ events: [ev("done", leap, { card: "a" })] }))).toEqual({ unlocked: true, at: leap });
    expect(test("new-year")(facts({ events: [ev("done", spooky, { card: "a" })] }))).toEqual({ unlocked: false, at: undefined });
  });

  it("dates the ship that completes a year's four seasons", () => {
    const jan = new Date(2026, 0, 10, 12).getTime();
    const apr = new Date(2026, 3, 10, 12).getTime();
    const jul = new Date(2026, 6, 10, 12).getTime();
    const oct = new Date(2026, 9, 10, 12).getTime();
    const events = [ev("done", jan, { card: "a" }), ev("done", apr, { card: "b" }), ev("done", jul, { card: "c" }), ev("done", oct, { card: "d" })];
    expect(test("four-seasons")(facts({ events }))).toEqual({ unlocked: true, at: oct });
    expect(test("four-seasons")(facts({ events: events.slice(0, 3) }))).toEqual({ unlocked: false, at: undefined });
  });

  it("does not join seasons across years", () => {
    const dec = new Date(2025, 11, 10, 12).getTime();
    const jan = new Date(2026, 0, 10, 12).getTime();
    const apr = new Date(2026, 3, 10, 12).getTime();
    const jul = new Date(2026, 6, 10, 12).getTime();
    const events = [ev("done", dec, { card: "a" }), ev("done", jan, { card: "b" }), ev("done", apr, { card: "c" }), ev("done", jul, { card: "d" })];
    expect(test("four-seasons")(facts({ events }))).toEqual({ unlocked: false, at: undefined });
  });
});
