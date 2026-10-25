import { describe, expect, it } from "vitest";
import { LEAGUE_DEFS } from "./league-badges";
import type { GameFacts, LeagueWeek } from "./game-badges";

// A week of league play: its Monday, the tier (0 Cotton .. 5 Gold Thread), your rank and the league's size.
const week = (w: string, tier: number, rank = 1, size = 10, done = true): LeagueWeek => ({ week: w, tier, rank, size, done });

// Game facts with league weeks and the social counts, the rest empty.
const facts = (over: Partial<GameFacts> = {}): GameFacts => ({
  events: [],
  bestStreak: 0,
  records: { biggestDay: null, mostShipped: null, maxRunning: 0, fastest: null, cheapest: null },
  projects: [],
  projectCount: 0,
  refactors: 0,
  climbed: false,
  ...over,
});

const test = (id: string) => LEAGUE_DEFS.find((d) => d.id === id)!.test;

// Noon local time on a day, the way a league week is dated.
const noonOf = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, day ?? 1, 12).getTime();
};

describe("promoted", () => {
  it("unlocks on the first week above the one before it", () => {
    expect(test("promoted")(facts({ leagueWeeks: [week("2026-10-05", 0), week("2026-10-12", 1)] }))).toEqual({
      unlocked: true, at: noonOf("2026-10-12"),
    });
  });

  it("stays locked at one tier or below", () => {
    expect(test("promoted")(facts({ leagueWeeks: [week("2026-10-05", 2), week("2026-10-12", 1)] }))).toEqual({
      unlocked: false, at: undefined,
    });
    expect(test("promoted")(facts({ leagueWeeks: [week("2026-10-05", 1), week("2026-10-12", 1)] }))).toEqual({
      unlocked: false, at: undefined,
    });
    expect(test("promoted")(facts({ leagueWeeks: [week("2026-10-05", 1)] }))).toEqual({ unlocked: false, at: undefined });
    expect(test("promoted")(facts())).toEqual({ unlocked: false, at: undefined });
  });
});

describe("gold-thread", () => {
  it("unlocks on the week you reach the top league", () => {
    expect(test("gold-thread")(facts({ leagueWeeks: [week("2026-10-05", 4), week("2026-10-12", 5)] }))).toEqual({
      unlocked: true, at: noonOf("2026-10-12"),
    });
  });

  it("stays locked below the top league", () => {
    expect(test("gold-thread")(facts({ leagueWeeks: [week("2026-10-05", 4)] }))).toEqual({ unlocked: false, at: undefined });
    expect(test("gold-thread")(facts())).toEqual({ unlocked: false, at: undefined });
  });
});

describe("week-winner", () => {
  it("unlocks on the Sunday a finished week ended", () => {
    expect(test("week-winner")(facts({ leagueWeeks: [week("2026-10-05", 1, 1, 12)] }))).toEqual({
      unlocked: true, at: noonOf("2026-10-11"),
    });
  });

  it("needs a finished week, first place and a league of two", () => {
    expect(test("week-winner")(facts({ leagueWeeks: [week("2026-10-05", 1, 1, 12, false)] }))).toEqual({ unlocked: false, at: undefined });
    expect(test("week-winner")(facts({ leagueWeeks: [week("2026-10-05", 1, 2, 12)] }))).toEqual({ unlocked: false, at: undefined });
    expect(test("week-winner")(facts({ leagueWeeks: [week("2026-10-05", 1, 1, 1)] }))).toEqual({ unlocked: false, at: undefined });
    expect(test("week-winner")(facts())).toEqual({ unlocked: false, at: undefined });
  });
});

describe("podium", () => {
  it("unlocks on the Sunday a podium week ended", () => {
    expect(test("podium")(facts({ leagueWeeks: [week("2026-10-05", 1, 3, 12)] }))).toEqual({
      unlocked: true, at: noonOf("2026-10-11"),
    });
  });

  it("needs a finished week, the top three and a league of four", () => {
    expect(test("podium")(facts({ leagueWeeks: [week("2026-10-05", 1, 3, 12, false)] }))).toEqual({ unlocked: false, at: undefined });
    expect(test("podium")(facts({ leagueWeeks: [week("2026-10-05", 1, 4, 12)] }))).toEqual({ unlocked: false, at: undefined });
    expect(test("podium")(facts({ leagueWeeks: [week("2026-10-05", 1, 2, 3)] }))).toEqual({ unlocked: false, at: undefined });
    expect(test("podium")(facts())).toEqual({ unlocked: false, at: undefined });
  });
});

describe("comeback", () => {
  it("unlocks on the week you came back up after a drop", () => {
    const list = [week("2026-10-05", 2), week("2026-10-12", 1), week("2026-10-19", 2)];
    expect(test("comeback")(facts({ leagueWeeks: list }))).toEqual({ unlocked: true, at: noonOf("2026-10-19") });
  });

  it("needs three weeks in a row", () => {
    const gap = [week("2026-10-05", 2), week("2026-10-12", 1), week("2026-10-26", 2)];
    expect(test("comeback")(facts({ leagueWeeks: gap }))).toEqual({ unlocked: false, at: undefined });
    expect(test("comeback")(facts({ leagueWeeks: [week("2026-10-05", 2), week("2026-10-12", 1)] }))).toEqual({ unlocked: false, at: undefined });
    expect(test("comeback")(facts())).toEqual({ unlocked: false, at: undefined });
  });

  it("needs a drop before the climb back", () => {
    const steady = [week("2026-10-05", 1), week("2026-10-12", 1), week("2026-10-19", 2)];
    expect(test("comeback")(facts({ leagueWeeks: steady }))).toEqual({ unlocked: false, at: undefined });
    const deeper = [week("2026-10-05", 3), week("2026-10-12", 2), week("2026-10-19", 1)];
    expect(test("comeback")(facts({ leagueWeeks: deeper }))).toEqual({ unlocked: false, at: undefined });
  });
});

describe("season-ticket", () => {
  it("unlocks on the tenth week in a league", () => {
    const list = ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30", "2026-12-07"]
      .map((w) => week(w, 1));
    expect(test("season-ticket")(facts({ leagueWeeks: list }))).toEqual({
      unlocked: true, at: noonOf("2026-12-07"), have: 10, need: 10,
    });
  });

  it("counts the weeks played so far", () => {
    const list = ["2026-10-05", "2026-10-12", "2026-10-19"].map((w) => week(w, 1));
    expect(test("season-ticket")(facts({ leagueWeeks: list }))).toEqual({
      unlocked: false, at: undefined, have: 3, need: 10,
    });
    expect(test("season-ticket")(facts())).toEqual({ unlocked: false, at: undefined, have: 0, need: 10 });
  });

  it("counts weeks in any league, dated by the tenth", () => {
    const list = [
      week("2026-10-05", 1), week("2026-10-12", 1), week("2026-10-19", 2), week("2026-10-26", 2),
      week("2026-11-02", 2), week("2026-11-09", 2), week("2026-11-16", 2), week("2026-11-23", 2),
      week("2026-11-30", 2), week("2026-12-07", 2), week("2026-12-14", 2), week("2026-12-21", 2),
    ];
    expect(test("season-ticket")(facts({ leagueWeeks: list }))).toEqual({
      unlocked: true, at: noonOf("2026-12-07"), have: 10, need: 10,
    });
  });
});

describe("social", () => {
  it("counts the builders you referred", () => {
    expect(test("recruiter-1")(facts({ referrals: 1 }))).toEqual({ unlocked: true, have: 1, need: 1 });
    expect(test("recruiter-1")(facts({ referrals: 0 }))).toEqual({ unlocked: false, have: 0, need: 1 });
    expect(test("recruiter-5")(facts({ referrals: 5 }))).toEqual({ unlocked: true, have: 5, need: 5 });
    expect(test("recruiter-5")(facts({ referrals: 4 }))).toEqual({ unlocked: false, have: 4, need: 5 });
    expect(test("recruiter-25")(facts({ referrals: 25 }))).toEqual({ unlocked: true, have: 25, need: 25 });
    expect(test("recruiter-25")(facts({ referrals: 24 }))).toEqual({ unlocked: false, have: 24, need: 25 });
    expect(test("recruiter-25")(facts())).toEqual({ unlocked: false, have: 0, need: 25 });
  });

  it("counts the size of your team", () => {
    expect(test("crew")(facts({ teamSize: 5 }))).toEqual({ unlocked: true, have: 5, need: 5 });
    expect(test("crew")(facts({ teamSize: 4 }))).toEqual({ unlocked: false, have: 4, need: 5 });
    expect(test("crew")(facts())).toEqual({ unlocked: false, have: 0, need: 5 });
  });
});

describe("the family", () => {
  it("has one def per badge, all named and grouped", () => {
    expect(new Set(LEAGUE_DEFS.map((d) => d.id)).size).toBe(LEAGUE_DEFS.length);
    expect(LEAGUE_DEFS.map((d) => d.id)).toEqual([
      "promoted", "gold-thread", "week-winner", "podium", "comeback", "season-ticket",
      "recruiter-1", "recruiter-5", "recruiter-25", "crew",
    ]);
    for (const d of LEAGUE_DEFS) {
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.desc.length).toBeGreaterThan(0);
      expect(d.icon.length).toBeGreaterThan(0);
    }
    expect(LEAGUE_DEFS.filter((d) => d.group === "Leagues").length).toBe(6);
    expect(LEAGUE_DEFS.filter((d) => d.group === "Social").length).toBe(4);
  });
});
