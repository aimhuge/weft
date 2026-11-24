import { describe, expect, it } from "vitest";
import {
  daysLeft,
  leaguesOf,
  moveOf,
  REACH_XP,
  resultFacts,
  standingFacts,
  utcWeek,
  type Builder,
  type StandingFacts,
  type WeekRow,
} from "./league-mail";
import { builder, FRIDAY, MONDAY, row, SATURDAY, SUNDAY, THURSDAY, TUESDAY } from "./league-mail.fixtures";

// All times in this file are UTC, never local (the test machine runs at UTC+7).

describe("utcWeek and daysLeft", () => {
  it("returns the Monday of the UTC week", () => {
    expect(utcWeek(MONDAY)).toBe("2026-10-12");
    expect(utcWeek(TUESDAY)).toBe("2026-10-12");
    expect(utcWeek(THURSDAY)).toBe("2026-10-12");
    expect(utcWeek(SATURDAY)).toBe("2026-10-12");
    expect(utcWeek(SUNDAY)).toBe("2026-10-12");
  });

  it("is the Sunday-of-the-previous-week's Monday for a Monday after the previous Sunday", () => {
    // Sun 18 Oct 2026 → that week's Monday is 12 Oct.
    expect(utcWeek(SUNDAY)).toBe("2026-10-12");
    // Sun 11 Oct 2026 → previous Monday is 5 Oct.
    expect(utcWeek(Date.UTC(2026, 9, 11, 23, 59, 59))).toBe("2026-10-05");
  });

  it("counts today as 1 and Monday as 7", () => {
    expect(daysLeft(MONDAY)).toBe(7);
    expect(daysLeft(TUESDAY)).toBe(6);
    expect(daysLeft(THURSDAY)).toBe(4);
    expect(daysLeft(FRIDAY)).toBe(3);
    expect(daysLeft(SATURDAY)).toBe(2);
    expect(daysLeft(SUNDAY)).toBe(1);
  });
});

describe("leaguesOf", () => {
  it("groups by tier and cohort, sorts best first, ranks ties the same", () => {
    const ranked = leaguesOf([
      row({ user_id: "a", tier: 0, cohort: 0, xp: 50 }),
      row({ user_id: "b", tier: 0, cohort: 0, xp: 100 }),
      row({ user_id: "c", tier: 0, cohort: 0, xp: 100 }),
      row({ user_id: "d", tier: 0, cohort: 0, xp: 30 }),
      row({ user_id: "e", tier: 1, cohort: 0, xp: 999 }),
    ]);
    const zero = ranked.get("0:0")!;
    expect(zero.map((e) => e.row.user_id)).toEqual(["b", "c", "a", "d"]);
    expect(zero.map((e) => e.rank)).toEqual([1, 1, 3, 4]);
    const one = ranked.get("1:0")!;
    expect(one).toHaveLength(1);
    expect(one[0]?.row).toMatchObject({ user_id: "e" });
    expect(one[0]?.rank).toBe(1);
  });

  it("puts a pooled week in one open league across tiers", () => {
    const ranked = leaguesOf([row({ user_id: "a", tier: 2, xp: 50 }), row({ user_id: "z", tier: 3, xp: 90 })], true);
    expect([...ranked.keys()]).toEqual(["pool"]);
    expect(ranked.get("pool")!.map((e) => [e.row.user_id, e.rank])).toEqual([["z", 1], ["a", 2]]);
  });

  it("returns an empty map for no rows", () => {
    expect(leaguesOf([]).size).toBe(0);
  });
});

describe("moveOf", () => {
  it("moves the top up when not the top tier and there is XP and more than one builder", () => {
    // size 30 → up 7, down 5.
    expect(moveOf(1, 100, 30, 0)).toBe("up");
    expect(moveOf(7, 50, 30, 0)).toBe("up");
  });

  it("moves the bottom down when not the bottom tier", () => {
    expect(moveOf(30, 5, 30, 1)).toBe("down");
    expect(moveOf(26, 0, 30, 1)).toBe("down");
  });

  it("stays in the middle", () => {
    expect(moveOf(15, 5, 30, 2)).toBe("stay");
  });

  it("never moves Gold Thread up or Cotton down", () => {
    expect(moveOf(1, 100, 30, 5)).toBe("stay");
    expect(moveOf(30, 5, 30, 0)).toBe("stay");
  });

  it("never moves an XP-less builder up or a lone builder up", () => {
    expect(moveOf(1, 0, 30, 0)).toBe("stay");
    expect(moveOf(1, 100, 1, 0)).toBe("stay");
  });
});

describe("standingFacts", () => {
  const byId = (rows: WeekRow[], names: Record<string, string>) => {
    const m = new Map<string, Builder>();
    for (const r of rows) m.set(r.user_id, builder({ id: r.user_id, name: names[r.user_id] ?? "Builder" }));
    return m;
  };
  const last = (league: { row: WeekRow; rank: number }[], me: WeekRow) => league.find((e) => e.row.user_id === me.user_id)!;

  it("is null when alone in the league", () => {
    const me = row({ user_id: "a", tier: 0, cohort: 0, xp: 100 });
    const league = leaguesOf([me]).get("0:0")!;
    expect(standingFacts(me, league, byId([me], { a: "Alex" }), MONDAY)).toBeNull();
  });

  it("is the up zone, with a lead when someone is behind, and zero when no one is", () => {
    const me = row({ user_id: "a", tier: 0, cohort: 0, xp: 200 });
    const others = [
      row({ user_id: "b", xp: 150 }),
      row({ user_id: "c", xp: 100 }),
      row({ user_id: "d", xp: 50 }),
    ];
    const rows = [me, ...others];
    const league = leaguesOf(rows).get("0:0")!;
    // size 4 → up = ceil(4*7/30) = 1. a is rank 1, lead = 200 - 150 = 50.
    const withLead = standingFacts(me, league, byId(rows, { a: "Alex", b: "Bo", c: "Cy", d: "Dee" }), MONDAY)!;
    expect(withLead).toMatchObject({ zone: "up", gap: 0, lead: 200 - 150, rank: 1, size: 4, name: "Alex", league: "Cotton" });
    expect(last(league, me).rank).toBe(1);

    // When the top of the league is the only one in the up zone (up < size holds), but here up=1, so lead is computed.
    // Now a league where up == size (small enough that the entire league moves up), lead is 0.
    const tinyRows = [
      row({ user_id: "a", xp: 50 }),
      row({ user_id: "b", xp: 30 }),
    ];
    const tinyLeague = leaguesOf(tinyRows).get("0:0")!;
    // size 2 → up = 1, down = 0. up < size (1 < 2), so lead = 50 - 30 = 20.
    const stillLead = standingFacts(tinyRows[0]!, tinyLeague, byId(tinyRows, { a: "A", b: "B" }), MONDAY)!;
    expect(stillLead).toMatchObject({ zone: "up", lead: 20 });
  });

  it("returns 0 lead when nobody is behind the up zone (up equals size)", () => {
    // The lead formula is `me.xp - xpAt(up + 1)`. To make the lead exactly 0 with a builder in the up zone,
    // tie me with the next rank: me.xp = xpAt(up+1). With size 3, up=1, so we tie at rank 1–2 and put c at xp 0.
    const me = row({ user_id: "a", xp: 100 });
    const others = [
      row({ user_id: "b", xp: 100 }),
      row({ user_id: "c", xp: 0 }),
    ];
    const rows = [me, ...others];
    const league = leaguesOf(rows).get("0:0")!;
    // size 3 → up = 1, down = 0. a and b tie at rank 1, c is rank 3. me.xp = 100, xpAt(2) = 100.
    const facts = standingFacts(me, league, byId(rows, { a: "A", b: "B", c: "C" }), MONDAY)!;
    expect(facts.zone).toBe("up");
    expect(facts.lead).toBe(0);
  });

  it("is the down zone, with a positive gap to escape", () => {
    // size 30 → up=7, down=5. a is rank 30, tier 0 → zone is "down" only if tier > 0. Move me to tier 1.
    const meTier1 = row({ user_id: "a", tier: 1, cohort: 0, xp: 10 });
    const bigTier1 = [
      meTier1,
      ...Array.from({ length: 29 }, (_, i) => row({ user_id: `u${i}`, tier: 1, cohort: 0, xp: 1000 - i * 10 })),
    ];
    const bigTier1League = leaguesOf(bigTier1).get("1:0")!;
    // size 30 → up=7, down=5. rank(a) = 30, 30 > 30-5 → down zone. tier 1 > 0.
    const facts = standingFacts(meTier1, bigTier1League, byId(bigTier1, { a: "A" }), MONDAY)!;
    expect(facts.zone).toBe("down");
    expect(facts.gap).toBeGreaterThan(0);
    expect(facts.lead).toBe(0);
  });

  it("is null when within REACH_XP from the up zone — at the boundary and beyond", () => {
    // size 30 → up = 7. We are rank 8 (one past the up zone). xpAt(7) is the 7th builder's xp.
    // To make us land within reach: me.xp = xpAt(7) - 2, so gap = 3 (≤ REACH_XP).
    // Then beyond: me.xp = xpAt(7) - REACH_XP, gap = REACH_XP + 1 (> REACH_XP, null).
    const top = Array.from({ length: 7 }, (_, i) => row({ user_id: `top${i}`, xp: 1000 - i * 10 }));
    const me = row({ user_id: "me", xp: 1000 - 6 * 10 - 2 }); // gap = 3.
    const rest = Array.from({ length: 22 }, (_, i) => row({ user_id: `rest${i}`, xp: 0 }));
    const rows = [...top, me, ...rest];
    const league = leaguesOf(rows).get("0:0")!;
    const within = standingFacts(me, league, byId(rows, { me: "Me" }), MONDAY)!;
    expect(within.zone).toBeNull();
    expect(within.gap).toBe(3);

    const farMe = row({ user_id: "me", xp: 1000 - 6 * 10 - REACH_XP });
    const far = [...top, farMe, ...rest];
    const farLeague = leaguesOf(far).get("0:0")!;
    expect(standingFacts(farMe, farLeague, byId(far, { me: "Me" }), MONDAY)).toBeNull();

    // At the exact REACH_XP boundary, gap == REACH_XP, still returned.
    const edge = row({ user_id: "me", xp: 1000 - 6 * 10 - REACH_XP + 1 });
    const edgeRows = [...top, edge, ...rest];
    const edgeLeague = leaguesOf(edgeRows).get("0:0")!;
    expect(standingFacts(edge, edgeLeague, byId(edgeRows, { me: "Me" }), MONDAY)).toMatchObject({ zone: null, gap: REACH_XP });
  });

  it("is null on the top tier (tier 5) when not in a zone", () => {
    const top = Array.from({ length: 7 }, (_, i) => row({ user_id: `top${i}`, tier: 5, cohort: 0, xp: 1000 - i * 10 }));
    const me = row({ user_id: "me", tier: 5, cohort: 0, xp: 100 });
    const rest = Array.from({ length: 22 }, (_, i) => row({ user_id: `rest${i}`, tier: 5, cohort: 0, xp: 0 }));
    const rows = [...top, me, ...rest];
    const league = leaguesOf(rows).get("5:0")!;
    // Tier 5, not in a zone (we're rank 8, out of up zone) → null per the tier >= 5 early return.
    expect(standingFacts(me, league, byId(rows, { me: "Me" }), MONDAY)).toBeNull();
  });

  it("uses 'Builder' as a default name for a row with no profile", () => {
    const me = row({ user_id: "a", xp: 200 });
    const other = row({ user_id: "b", xp: 100 });
    const league = leaguesOf([me, other]).get("0:0")!;
    const builders = new Map<string, Builder>([["a", builder({ id: "a", name: "Alex" })]]);
    const facts = standingFacts(me, league, builders, MONDAY) as StandingFacts;
    expect(facts.name).toBe("Alex");
    expect(facts.top[1]?.name).toBe("Builder");
  });
});

describe("resultFacts", () => {
  const byId = (rows: WeekRow[], names: Record<string, string>) => {
    const m = new Map<string, Builder>();
    for (const r of rows) m.set(r.user_id, builder({ id: r.user_id, name: names[r.user_id] ?? "Builder" }));
    return m;
  };

  it("is null when 0 XP and staying put", () => {
    const me = row({ user_id: "a", xp: 0, shipped: 0 });
    const others = [
      row({ user_id: "b", xp: 0 }),
      row({ user_id: "c", xp: 0 }),
    ];
    const rows = [me, ...others];
    const league = leaguesOf(rows).get("0:0")!;
    expect(resultFacts(me, league, byId(rows, { a: "A" }), MONDAY)).toBeNull();
  });

  it("is the up move, with the next league name and shipped cards", () => {
    const me = row({ user_id: "a", xp: 500, shipped: 5 });
    const others = Array.from({ length: 6 }, (_, i) => row({ user_id: `u${i}`, xp: 100 - i * 5 }));
    const rows = [me, ...others];
    const league = leaguesOf(rows).get("0:0")!;
    const facts = resultFacts(me, league, byId(rows, { a: "Alex" }), MONDAY)!;
    expect(facts.move).toBe("up");
    expect(facts.next).toBe("Linen");
    expect(facts.shipped).toBe(5);
    expect(facts.rank).toBe(1);
  });

  it("is the down move to the previous league name", () => {
    const me = row({ user_id: "a", tier: 2, cohort: 0, xp: 5, shipped: 0 });
    const others = Array.from({ length: 29 }, (_, i) => row({ user_id: `u${i}`, tier: 2, cohort: 0, xp: 1000 - i * 10 }));
    const rows = [...others, me];
    const league = leaguesOf(rows).get("2:0")!;
    const facts = resultFacts(me, league, byId(rows, { a: "Alex" }), MONDAY)!;
    expect(facts.move).toBe("down");
    expect(facts.next).toBe("Linen");
  });

  it("is the stay move, with the same league name", () => {
    const me = row({ user_id: "a", xp: 100, shipped: 2 });
    const others = [
      row({ user_id: "b", xp: 200 }),
      row({ user_id: "c", xp: 50 }),
    ];
    const rows = [me, ...others];
    const league = leaguesOf(rows).get("0:0")!;
    const facts = resultFacts(me, league, byId(rows, { a: "Alex" }), MONDAY)!;
    expect(facts.move).toBe("stay");
    expect(facts.next).toBe("Cotton");
    expect(facts.shipped).toBe(2);
  });
});