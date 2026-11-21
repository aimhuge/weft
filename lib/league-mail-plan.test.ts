import { describe, expect, it } from "vitest";
import { XP } from "./game";
import { DAY_MS, leaguesOf, planLeagueMails, REACH_XP, resultFacts, standingFacts, WELCOME_WINDOW_MS, type Builder } from "./league-mail";
import {
  builder,
  FRIDAY,
  LAST_WEEK,
  MONDAY,
  row,
  SATURDAY,
  SUNDAY,
  THIS_WEEK,
  THURSDAY,
  TUESDAY,
} from "./league-mail.fixtures";

const b = (over: Partial<Builder>) => builder(over);

describe("planLeagueMails", () => {
  it("sends Monday results to everyone who played last week", () => {
    // Last week's rows: 3 builders, two with XP.
    const last = [
      row({ user_id: "a", week: LAST_WEEK, xp: 100, shipped: 3 }),
      row({ user_id: "b", week: LAST_WEEK, xp: 50, shipped: 1 }),
      row({ user_id: "c", week: LAST_WEEK, xp: 0, shipped: 0 }),
    ];
    // createdAt outside the welcome window so only the results branch runs.
    const builders = [
      b({ id: "a", name: "Alex", email: "a@w.test", createdAt: MONDAY - WELCOME_WINDOW_MS - 1 }),
      b({ id: "b", name: "Bo", email: "b@w.test", createdAt: MONDAY - WELCOME_WINDOW_MS - 1 }),
      b({ id: "c", name: "Cy", email: "c@w.test", createdAt: MONDAY - WELCOME_WINDOW_MS - 1 }),
    ];
    const mails = planLeagueMails({ now: MONDAY, thisWeek: [], lastWeek: last, builders, sent: [] });
    const kinds = mails.map((m) => m.kind);
    // c has 0 XP and stays → null. a and b both have results.
    expect(kinds.sort()).toEqual(["results", "results"]);
    expect(mails.find((m) => m.to === "a@w.test")?.facts).toMatchObject({ move: "up", rank: 1 });
    expect(mails.find((m) => m.to === "b@w.test")?.facts).toMatchObject({ move: "stay" });
  });

  it("ranks a small week as one open league, and a full one per tier", () => {
    const old = MONDAY - WELCOME_WINDOW_MS - 1;
    const small = [row({ user_id: "a", week: LAST_WEEK, tier: 2, xp: 600 }), row({ user_id: "z", week: LAST_WEEK, tier: 3, xp: 2000 })];
    const builders = [b({ id: "a", email: "a@w.test", createdAt: old }), b({ id: "z", email: "z@w.test", createdAt: old })];
    const pooled = planLeagueMails({ now: MONDAY, thisWeek: [], lastWeek: small, builders, sent: [] });
    expect(pooled.find((m) => m.userId === "a")?.facts).toMatchObject({ rank: 2 });
    const filler = Array.from({ length: 28 }, (_, i) => row({ user_id: `f${i}`, week: LAST_WEEK, tier: 0, xp: 1 }));
    const full = planLeagueMails({ now: MONDAY, thisWeek: [], lastWeek: [...small, ...filler], builders, sent: [] });
    expect(full.find((m) => m.userId === "a")?.facts).toMatchObject({ rank: 1 });
  });

  it("sends a welcome to a builder who just signed up, once", () => {
    const me = row({ user_id: "a" });
    const builders = [b({ id: "a", name: "Alex", email: "a@w.test", createdAt: MONDAY - 1 * DAY_MS })];
    const mails = planLeagueMails({ now: MONDAY, thisWeek: [me], lastWeek: [], builders, sent: [] });
    expect(mails).toHaveLength(1);
    expect(mails[0]?.kind).toBe("welcome");

    // Already-sent welcome is skipped.
    const again = planLeagueMails({
      now: MONDAY,
      thisWeek: [me],
      lastWeek: [],
      builders,
      sent: [{ user_id: "a", kind: "welcome", week: THIS_WEEK }],
    });
    expect(again).toEqual([]);
  });

  it("skips a welcome for a builder whose account is older than the welcome window", () => {
    const me = row({ user_id: "a" });
    const builders = [b({ id: "a", email: "a@w.test", createdAt: MONDAY - WELCOME_WINDOW_MS - 1 })];
    expect(planLeagueMails({ now: MONDAY, thisWeek: [me], lastWeek: [], builders, sent: [] })).toEqual([]);
  });

  it("sends Thursday's midweek standing to those with a zone or in reach", () => {
    // size 30, up = 7. Rank 1 → up zone. Rank 8 → within reach.
    const top = Array.from({ length: 7 }, (_, i) => row({ user_id: `top${i}`, xp: 1000 - i * 10 }));
    const inReach = row({ user_id: "reach", xp: 1000 - 6 * 10 - 1 });
    const far = row({ user_id: "far", xp: 0 });
    const rows = [...top, inReach, far, ...Array.from({ length: 20 }, (_, i) => row({ user_id: `z${i}`, xp: 0 }))];
    // createdAt outside the welcome window so offers only the midweek nudge.
    const builders = rows.map((r) => b({ id: r.user_id, name: r.user_id, email: `${r.user_id}@w.test`, createdAt: MONDAY - WELCOME_WINDOW_MS - 1 }));
    const mails = planLeagueMails({ now: THURSDAY, thisWeek: rows, lastWeek: [], builders, sent: [] });
    // top[0]–top[6] in the up zone, inReach within reach. far is too far; the rest are 0 XP and not in reach.
    const to = mails.map((m) => m.to).sort();
    expect(to).toContain("top0@w.test");
    expect(to).toContain("reach@w.test");
    expect(to).not.toContain("far@w.test");
    expect(mails.every((m) => m.kind === "midweek")).toBe(true);
  });

  it("sends Sunday's final nudge", () => {
    // Size 30 so a meaningful number of builders land in the up zone.
    const top = Array.from({ length: 7 }, (_, i) => row({ user_id: `top${i}`, xp: 1000 - i * 10 }));
    const inReach = row({ user_id: "reach", xp: 1000 - 6 * 10 - 2 }); // gap 3, within reach.
    const rest = Array.from({ length: 22 }, (_, i) => row({ user_id: `r${i}`, xp: 0 }));
    const rows = [...top, inReach, ...rest];
    const builders = rows.map((r) => b({ id: r.user_id, name: r.user_id, email: `${r.user_id}@w.test`, createdAt: MONDAY - WELCOME_WINDOW_MS - 1 }));
    const mails = planLeagueMails({ now: SUNDAY, thisWeek: rows, lastWeek: [], builders, sent: [] });
    // 7 in the up zone + 1 in reach.
    expect(mails.every((m) => m.kind === "final")).toBe(true);
    expect(mails).toHaveLength(8);
  });

  it("sends no nudges on Wednesday, Friday or Saturday", () => {
    const me = row({ user_id: "a", xp: 500 });
    const other = row({ user_id: "b", xp: 100 });
    const rows = [me, other];
    const builders = rows.map((r) => b({ id: r.user_id, email: `${r.user_id}@w.test`, createdAt: MONDAY - WELCOME_WINDOW_MS - 1 }));
    for (const day of [TUESDAY, FRIDAY, SATURDAY]) {
      const mails = planLeagueMails({ now: day, thisWeek: rows, lastWeek: [], builders, sent: [] });
      expect(mails.filter((m) => m.kind === "midweek" || m.kind === "final")).toEqual([]);
    }
  });

  it("prioritizes results over welcome over nudge (one per builder)", () => {
    // Builder a has last-week results (moved up), is in the welcome window, and is in the up zone this week.
    // On Monday, only results should be sent for a.
    const last = [row({ user_id: "a", week: LAST_WEEK, xp: 100, shipped: 3 })];
    const meThis = row({ user_id: "a", xp: 500 });
    const other = row({ user_id: "b", xp: 100 });
    const rows = [meThis, other];
    // Both within the welcome window (1 day old, so still in the 3-day window from THURSDAY).
    const builders = [
      b({ id: "a", name: "A", email: "a@w.test", createdAt: THURSDAY - 1 * DAY_MS }),
      b({ id: "b", name: "B", email: "b@w.test", createdAt: THURSDAY - 1 * DAY_MS }),
    ];
    const mails = planLeagueMails({ now: MONDAY, thisWeek: rows, lastWeek: last, builders, sent: [] });
    // a gets results, b gets a welcome. a is a fresh account but results wins (one per builder).
    const aMails = mails.filter((m) => m.userId === "a");
    expect(aMails).toHaveLength(1);
    expect(aMails[0]?.kind).toBe("results");
    // b had no last-week data, but is in the welcome window → a welcome.
    expect(mails.find((m) => m.userId === "b")?.kind).toBe("welcome");

    // On Thursday, the same fresh accounts are still within the window (1 day before THURSDAY).
    // No last week, builder a is in the up zone; welcome is offered first.
    const thurs = planLeagueMails({
      now: THURSDAY,
      thisWeek: rows,
      lastWeek: [],
      builders,
      sent: [],
    });
    const aThurs = thurs.filter((m) => m.userId === "a");
    expect(aThurs).toHaveLength(1);
    // Welcome wins over the nudge because the builder is in the welcome window.
    expect(aThurs[0]?.kind).toBe("welcome");
  });

  it("skips opted-out and no-email builders", () => {
    const rows = [
      row({ user_id: "a", xp: 500 }),
      row({ user_id: "b", xp: 500 }),
      row({ user_id: "c", xp: 500 }),
    ];
    const builders = [
      b({ id: "a", email: "a@w.test", createdAt: MONDAY - WELCOME_WINDOW_MS - 1 }),
      b({ id: "b", email: null, createdAt: MONDAY - WELCOME_WINDOW_MS - 1 }),
      b({ id: "c", email: "c@w.test", optedIn: false, createdAt: MONDAY - WELCOME_WINDOW_MS - 1 }),
    ];
    const mails = planLeagueMails({ now: THURSDAY, thisWeek: rows, lastWeek: [], builders, sent: [] });
    expect(mails.map((m) => m.to)).toEqual(["a@w.test"]);
  });

  it("skips mails already in the sent log", () => {
    const rows = [
      row({ user_id: "a", xp: 500 }),
      row({ user_id: "b", xp: 500 }),
    ];
    const builders = rows.map((r) => b({ id: r.user_id, email: `${r.user_id}@w.test`, createdAt: MONDAY - WELCOME_WINDOW_MS - 1 }));
    const mails = planLeagueMails({
      now: THURSDAY,
      thisWeek: rows,
      lastWeek: [],
      builders,
      sent: [{ user_id: "a", kind: "midweek", week: THIS_WEEK }],
    });
    expect(mails.map((m) => m.userId).sort()).toEqual(["b"]);
  });

  it("falls back to 'Builder' when the profile is missing from the builders map", () => {
    const me = row({ user_id: "a" });
    const league = leaguesOf([me, row({ user_id: "b" })]).get("0:0")!;
    // No profile for a.
    const builders = new Map<string, Builder>();
    const facts = resultFacts(me, league, builders, MONDAY);
    // resultFacts for me: 0 XP, 0 shipped, 2 builders → rank 1, move up. So facts is defined, name "Builder".
    expect(facts?.name).toBe("Builder");
    // Empty builders map → builder has no name; standingFacts also has a default.
    const stand = standingFacts(me, league, builders, MONDAY);
    expect(stand?.name).toBe("Builder");
  });

  it("uses WELCOME_WINDOW_MS and REACH_XP as documented", () => {
    expect(WELCOME_WINDOW_MS).toBe(3 * DAY_MS);
    expect(REACH_XP).toBe(6 * XP.done);
  });
});