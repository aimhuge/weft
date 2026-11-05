import { describe, expect, it } from "vitest";
import { CRAFT_DEFS } from "./craft-badges";
import type { Habit } from "./craft-types";
import type { ActivityEvent, Records } from "./game";
import type { GameFacts } from "./game-badges";

const noRecords: Records = { biggestDay: null, mostShipped: null, maxRunning: 0, fastest: null, cheapest: null };

function facts(overrides: Partial<GameFacts> = {}): GameFacts {
  return {
    events: [],
    bestStreak: 0,
    records: noRecords,
    projects: [],
    projectCount: 0,
    refactors: 0,
    climbed: false,
    ...overrides,
  };
}

const at = (d: number, h: number, mi = 0) => new Date(2026, 9, d, h, mi).getTime();

// A Done event for a card, with the title it shipped under.
const done = (card: string, when: number, title = "Add a thing", cwd = "/work/app"): ActivityEvent => ({
  id: `done-${card}`,
  kind: "done",
  at: when,
  card,
  title,
  cwd,
});

// Each card's habits, by card id.
const habitsOf = (map: Record<string, Habit[]>) => new Map(Object.entries(map).map(([card, list]) => [card, new Set(list)]));

const test = (id: string) => CRAFT_DEFS.find((d) => d.id === id)!.test;

describe("craft badges", () => {
  it("counts a shipped card that ran /done, dated by that ship", () => {
    const one = facts({ events: [done("a", at(20, 10))], habits: habitsOf({ a: ["wrap"] }) });
    expect(test("wrapped-up")(one)).toEqual({ unlocked: true, at: at(20, 10), have: 1, need: 1 });

    const none = facts({ events: [done("a", at(20, 10))], habits: habitsOf({ a: ["review"] }) });
    expect(test("wrapped-up")(none)).toEqual({ unlocked: false, have: 0, need: 1 });
  });

  it("counts a hundred /done cards for the ritualist", () => {
    const events = Array.from({ length: 100 }, (_, i) => done(`c${i}`, at(20, 9) + i * 1000));
    const habits = habitsOf(Object.fromEntries(events.map((e) => [e.card!, ["wrap"]])));
    expect(test("ritualist")(facts({ events, habits }))).toEqual({ unlocked: true, at: at(20, 9) + 99 * 1000, have: 100, need: 100 });

    const few = facts({ events: events.slice(0, 99), habits: habitsOf(Object.fromEntries(events.slice(0, 99).map((e) => [e.card!, ["wrap"]]))) });
    expect(test("ritualist")(few)).toEqual({ unlocked: false, have: 99, need: 100 });
  });

  it("counts code reviews for the second opinion", () => {
    const events = Array.from({ length: 10 }, (_, i) => done(`r${i}`, at(21, 9) + i * 1000));
    const habits = habitsOf(Object.fromEntries(events.map((e) => [e.card!, ["review"]])));
    expect(test("second-opinion")(facts({ events, habits }))).toEqual({ unlocked: true, at: at(21, 9) + 9 * 1000, have: 10, need: 10 });
    expect(test("second-opinion")(facts({ events, habits: habitsOf({ r0: ["review"] }) }))).toEqual({ unlocked: false, have: 1, need: 10 });
  });

  it("counts doc updates for the archivist", () => {
    const events = Array.from({ length: 25 }, (_, i) => done(`d${i}`, at(22, 9) + i * 1000));
    const habits = habitsOf(Object.fromEntries(events.map((e) => [e.card!, ["docs"]])));
    expect(test("archivist")(facts({ events, habits }))).toEqual({ unlocked: true, at: at(22, 9) + 24 * 1000, have: 25, need: 25 });
    expect(test("archivist")(facts())).toEqual({ unlocked: false, have: 0, need: 25 });
  });

  it("counts a card shipped twice once", () => {
    const events = [done("a", at(20, 10)), { ...done("a", at(20, 18)), id: "done-a-2" }];
    const habits = habitsOf({ a: ["wrap"] });
    expect(test("wrapped-up")(facts({ events, habits }))).toEqual({ unlocked: true, at: at(20, 10), have: 1, need: 1 });
  });

  it("ignores a Done event with no card", () => {
    const events: ActivityEvent[] = [{ id: "done-x", kind: "done", at: at(20, 10) }];
    expect(test("wrapped-up")(facts({ events }))).toEqual({ unlocked: false, have: 0, need: 1 });
  });
});

describe("boy scout", () => {
  it("wants a refactor and a feature in one project on the same day", () => {
    const events = [
      done("ref", at(20, 9), "Refactor the loader"),
      done("feat", at(20, 17), "Add a loader"),
    ];
    expect(test("boy-scout")(facts({ events }))).toEqual({ unlocked: true, at: at(20, 17) });
  });

  it("wants both halves in the same project", () => {
    const events = [
      done("ref", at(20, 9), "Refactor the loader", "/work/app"),
      done("feat", at(20, 17), "Add a loader", "/work/other"),
    ];
    expect(test("boy-scout")(facts({ events, roots: new Map([["/work/app", "/root/app"], ["/work/other", "/root/other"]]) })))
      .toEqual({ unlocked: false });
  });

  it("follows the card's folder to its project root", () => {
    const events = [
      done("ref", at(20, 9), "Refactor the loader", "/work/app/sub"),
      done("feat", at(20, 17), "Add a loader", "/work/app/other"),
    ];
    const roots = new Map([["/work/app/sub", "/root/app"], ["/work/app/other", "/root/app"]]);
    expect(test("boy-scout")(facts({ events, roots }))).toEqual({ unlocked: true, at: at(20, 17) });
  });

  it("wants them on the same local day", () => {
    const events = [
      done("ref", at(20, 9), "Refactor the loader"),
      done("feat", at(21, 17), "Add a loader"),
    ];
    expect(test("boy-scout")(facts({ events }))).toEqual({ unlocked: false });
  });

  it("takes the first pair in time order", () => {
    const events = [
      done("ref", at(20, 9), "Refactor the loader"),
      done("feat", at(20, 17), "Add a loader"),
      done("ref2", at(22, 9), "Refactor the store"),
      done("feat2", at(22, 17), "Add a store"),
    ];
    expect(test("boy-scout")(facts({ events }))).toEqual({ unlocked: true, at: at(20, 17) });
  });

  it("takes the earliest pair even when a later one is found first", () => {
    const events = [
      done("ref2", at(22, 9), "Refactor the store"),
      done("feat2", at(22, 17), "Add a store"),
      done("ref", at(20, 9), "Refactor the loader"),
      done("feat", at(20, 17), "Add a loader"),
    ];
    expect(test("boy-scout")(facts({ events }))).toEqual({ unlocked: true, at: at(20, 17) });
  });

  it("treats a card with no folder as its own project", () => {
    const events: ActivityEvent[] = [
      { id: "done-ref", kind: "done", at: at(20, 9), card: "ref", title: "Refactor the loader" },
      { id: "done-feat", kind: "done", at: at(20, 17), card: "feat", title: "Add a loader" },
    ];
    expect(test("boy-scout")(facts({ events }))).toEqual({ unlocked: true, at: at(20, 17) });
  });

  it("needs a feature as well as a refactor", () => {
    const events = [done("ref", at(20, 9), "Refactor the loader"), done("ref2", at(20, 11), "Refactor the store")];
    expect(test("boy-scout")(facts({ events }))).toEqual({ unlocked: false });
    expect(test("boy-scout")(facts())).toEqual({ unlocked: false });
  });
});

describe("board badges", () => {
  it("counts the cards in Backlog", () => {
    expect(test("dreamer")(facts({ board: { backlog: 50, tagged: 0 } }))).toEqual({ unlocked: true, have: 50, need: 50 });
    expect(test("dreamer")(facts({ board: { backlog: 49, tagged: 0 } }))).toEqual({ unlocked: false, have: 49, need: 50 });
    expect(test("dreamer")(facts())).toEqual({ unlocked: false, have: 0, need: 50 });
  });

  it("counts the tagged cards", () => {
    expect(test("librarian")(facts({ board: { backlog: 0, tagged: 60 } }))).toEqual({ unlocked: true, have: 50, need: 50 });
    expect(test("librarian")(facts({ board: { backlog: 0, tagged: 10 } }))).toEqual({ unlocked: false, have: 10, need: 50 });
    expect(test("librarian")(facts())).toEqual({ unlocked: false, have: 0, need: 50 });
  });
});
