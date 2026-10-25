import { describe, expect, it } from "vitest";
import { leanMonth, SPEND_DEFS } from "./spend-badges";
import type { ActivityEvent } from "./game";
import type { GameFacts } from "./game-badges";

const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const noon = (day: number) => local(day, 12);
const event = (kind: ActivityEvent["kind"], at: number, extra: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id: `${kind}-${at}-${extra.card ?? ""}`, at, kind, ...extra,
});

function facts(overrides: Partial<GameFacts> = {}): GameFacts {
  return {
    events: [], bestStreak: 0,
    records: { biggestDay: null, mostShipped: null, maxRunning: 0, fastest: null, cheapest: null },
    projects: [], projectCount: 0, refactors: 0, climbed: false, ...overrides,
  };
}

const test = (id: string) => SPEND_DEFS.find((d) => d.id === id)!.test;

// A day's tokens in and out, as lib/usage-scan.ts counts them.
const tokens = (entries: [string, [number, number]][]) => new Map(entries);

// A shipped card: a Done event with its cost.
const done = (card: string, at: number, cost?: number) => event("done", at, { card, ...(cost !== undefined && { cost }) });

describe("spend badges", () => {
  it("counts tokens through the threads", () => {
    const f = facts({ tokens: tokens([["2026-10-24", [600_000, 500_000]]]) });
    expect(test("tokens-1m")(f)).toEqual({ unlocked: true, at: noon(24), have: 1_000_000, need: 1_000_000 });
  });

  it("adds a day's input and output together", () => {
    const f = facts({ tokens: tokens([["2026-10-24", [600_000, 400_000]]]) });
    expect(test("tokens-1m")(f)).toEqual({ unlocked: true, at: noon(24), have: 1_000_000, need: 1_000_000 });
  });

  it("carries a day's tokens to the next", () => {
    const f = facts({ tokens: tokens([["2026-10-23", [600_000, 0]], ["2026-10-24", [600_000, 0]]]) });
    expect(test("tokens-1m")(f)).toEqual({ unlocked: true, at: noon(24), have: 1_000_000, need: 1_000_000 });
  });

  it("counts the days in order, however they were logged", () => {
    const f = facts({ tokens: tokens([["2026-10-24", [600_000, 0]], ["2026-10-23", [600_000, 0]]]) });
    expect(test("tokens-1m")(f)).toEqual({ unlocked: true, at: noon(24), have: 1_000_000, need: 1_000_000 });
  });

  it("is locked with nothing spent", () => {
    expect(test("tokens-1m")(facts())).toEqual({ unlocked: false, have: 0, need: 1_000_000 });
  });

  it("climbs the ladder of token counts", () => {
    const f = facts({ tokens: tokens([["2026-10-24", [11_000_000, 0]]]) });
    expect(test("tokens-10m")(f)).toEqual({ unlocked: true, at: noon(24), have: 10_000_000, need: 10_000_000 });
    expect(test("tokens-100m")(f)).toEqual({ unlocked: false, have: 11_000_000, need: 100_000_000 });
  });

  it("needs a hundred million and then a billion", () => {
    expect(test("tokens-100m")(facts({ tokens: tokens([["2026-10-24", [100_000_000, 0]]]) }))).toMatchObject({ unlocked: true, at: noon(24) });
    expect(test("tokens-1b")(facts({ tokens: tokens([["2026-10-24", [1_000_000_000, 0]]]) }))).toMatchObject({ unlocked: true, at: noon(24) });
  });

  it("dates a tidal wave by its day", () => {
    const f = facts({ tokens: tokens([["2026-10-23", [9_000_000, 0]], ["2026-10-24", [10_000_000, 0]]]) });
    expect(test("tidal-wave")(f)).toEqual({ unlocked: true, at: noon(24) });
  });

  it("has no tidal wave without one big day", () => {
    const f = facts({ tokens: tokens([["2026-10-23", [9_999_999, 0]]]) });
    expect(test("tidal-wave")(f)).toEqual({ unlocked: false, at: undefined });
  });

  it("finds a day your threads wrote more than they read", () => {
    const f = facts({ tokens: tokens([["2026-10-23", [500_000, 100_000]], ["2026-10-24", [100_000, 500_000]]]) });
    expect(test("chatterbox")(f)).toEqual({ unlocked: true, at: noon(24) });
  });

  it("has no chatterbox when every day read more than it wrote", () => {
    const f = facts({ tokens: tokens([["2026-10-23", [500_000, 100_000]], ["2026-10-24", [500_000, 100_000]]]) });
    expect(test("chatterbox")(f)).toEqual({ unlocked: false, at: undefined });
  });

  it("finds a card shipped for under ten cents", () => {
    const f = facts({ events: [done("a", local(24, 9), 0.05)] });
    expect(test("penny-pincher")(f)).toEqual({ unlocked: true, at: local(24, 9) });
  });

  it("has no penny pincher without a cheap card", () => {
    const f = facts({ events: [done("a", local(24, 9), 0.5)] });
    expect(test("penny-pincher")(f)).toEqual({ unlocked: false, at: undefined });
  });

  it("finds a card shipped for twenty dollars or more", () => {
    const f = facts({ events: [done("a", local(24, 9), 20)] });
    expect(test("whale")(f)).toEqual({ unlocked: true, at: local(24, 9) });
  });

  it("has no whale without a costly card", () => {
    const f = facts({ events: [done("a", local(24, 9), 19.99)] });
    expect(test("whale")(f)).toEqual({ unlocked: false, at: undefined });
  });

  it("counts a card's cost once, even when it ships twice", () => {
    const f = facts({ events: [done("a", local(24, 9), 60), done("a", local(25, 9), 60)] });
    expect(test("patron-100")(f)).toEqual({ unlocked: false, have: 60, need: 100 });
  });

  it("leaves out a Done with no cost", () => {
    const f = facts({ events: [done("a", local(24, 9)), done("b", local(25, 9), 0)] });
    expect(test("penny-pincher")(f)).toEqual({ unlocked: false, at: undefined });
    expect(test("patron-100")(f)).toEqual({ unlocked: false, have: 0, need: 100 });
  });

  it("sums the model time on shipped work", () => {
    const f = facts({ events: [done("a", local(24, 9), 40), done("b", local(25, 9), 70)] });
    expect(test("patron-100")(f)).toEqual({ unlocked: true, at: local(25, 9), have: 100, need: 100 });
    expect(test("patron-1000")(f)).toEqual({ unlocked: false, have: 110, need: 1000 });
  });

  it("is a benefactor past a thousand dollars", () => {
    const f = facts({ events: [done("a", local(24, 9), 1000)] });
    expect(test("patron-1000")(f)).toEqual({ unlocked: true, at: local(24, 9), have: 1000, need: 1000 });
  });
});

describe("leanMonth", () => {
  // A month of priced cards: the cost of each, and the month it falls in. The cards are named
  // apart, since shipped() counts a card once however often it ships.
  const month = (cards: [number, number][], year: number, mon: number, tag: string) =>
    cards.map(([i, cost], n) => done(`${tag}${n}`, new Date(year, mon, 1 + i, 9).getTime(), cost));

  it("unlocks when the average cost per card drops 30% in a month", () => {
    const f = facts({
      events: [
        ...month([[0, 10], [1, 10], [2, 10], [3, 10], [4, 10]], 2026, 8, "a"),
        ...month([[0, 5], [1, 5], [2, 5], [3, 5], [4, 5]], 2026, 9, "b"),
      ],
    });
    expect(leanMonth(f)).toEqual({ unlocked: true, at: new Date(2026, 9, 5, 9).getTime() });
  });

  it("is dated by the last card of the lean month", () => {
    const f = facts({
      events: [
        ...month([[0, 10], [1, 10], [2, 10], [3, 10], [4, 10]], 2026, 8, "a"),
        ...month([[0, 5], [1, 5], [2, 5], [3, 5], [4, 5]], 2026, 9, "b"),
      ],
    });
    expect(leanMonth(f).at).toBe(new Date(2026, 9, 5, 9).getTime());
  });

  it("stays locked when the average barely moved", () => {
    const f = facts({
      events: [
        ...month([[0, 10], [1, 10], [2, 10], [3, 10], [4, 10]], 2026, 8, "a"),
        ...month([[0, 9], [1, 9], [2, 9], [3, 9], [4, 9]], 2026, 9, "b"),
      ],
    });
    expect(leanMonth(f)).toEqual({ unlocked: false });
  });

  it("needs five priced cards in both months", () => {
    const f = facts({
      events: [
        ...month([[0, 10], [1, 10], [2, 10], [3, 10]], 2026, 8, "a"),
        ...month([[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]], 2026, 9, "b"),
      ],
    });
    expect(leanMonth(f)).toEqual({ unlocked: false });
  });

  it("needs the months to sit next to each other", () => {
    const f = facts({
      events: [
        ...month([[0, 10], [1, 10], [2, 10], [3, 10], [4, 10]], 2026, 6, "a"),
        ...month([[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]], 2026, 9, "b"),
      ],
    });
    expect(leanMonth(f)).toEqual({ unlocked: false });
  });

  it("has nothing to measure with no shipped cards", () => {
    expect(leanMonth(facts())).toEqual({ unlocked: false });
  });

  it("ignores cards shipped without a price", () => {
    const f = facts({
      events: [
        ...month([[0, 10], [1, 10], [2, 10], [3, 10], [4, 10]], 2026, 8, "a"),
        done("free", new Date(2026, 9, 2, 9).getTime()),
        ...month([[0, 1], [1, 1], [2, 1], [3, 1]], 2026, 9, "b"),
      ],
    });
    expect(leanMonth(f)).toEqual({ unlocked: false });
  });

  it("is the lean month badge", () => {
    expect(test("lean-month")).toBe(leanMonth);
  });
});
