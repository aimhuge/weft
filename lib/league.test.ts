import { describe, expect, it } from "vitest";
import type { Badge } from "./game-badges";
import { leagueEntry, leagueMoves, leagueName, profileUrl, toLeagueView, toTierView, weekBadges, zoneOf, type BrowseRow, type StandingRow } from "./league";

// Sat 17 Oct 2026, local noon; its week starts Mon 12 Oct.
const NOW = new Date(2026, 9, 17, 12).getTime();
const at = (d: number) => new Date(2026, 9, d, 9).getTime();
const badge = (id: string, extra: Partial<Badge> = {}): Badge => ({ id, icon: "🏅", name: id, desc: "", group: "shipping", unlocked: true, ...extra } as Badge);

const row = (over: Partial<StandingRow> = {}): StandingRow => ({
  rank: 1, user_id: "u1", name: "Alex", avatar_url: "https://a/1.png", username: "fotoflo", xp: 100, shipped: 3,
  streak: 4, level: 7, badges: [], is_me: true, tier: 0, size: 1, ...over,
});

describe("weekBadges", () => {
  it("keeps only unlocked badges earned since Monday, newest first", () => {
    const list = [
      badge("old", { at: at(11) }),
      badge("mon", { at: at(12), icon: "🧵" }),
      badge("fri", { at: at(16), icon: "🔥" }),
      badge("locked", { unlocked: false, at: at(15) }),
      badge("undated"),
    ];
    expect(weekBadges(list, "2026-10-12")).toEqual([{ icon: "🔥", name: "fri" }, { icon: "🧵", name: "mon" }]);
  });

  it("caps at 12", () => {
    const many = Array.from({ length: 20 }, (_, i) => badge(`b${i}`, { at: at(13) + i }));
    expect(weekBadges(many, "2026-10-12")).toHaveLength(12);
  });
});

describe("leagueEntry", () => {
  it("is this week's numbers with the Monday as the week", () => {
    const game = { weekXp: 6588, weekShipped: 36, streak: { current: 31 }, level: { level: 20 }, badges: [badge("x", { at: at(14) })] };
    expect(leagueEntry(game, NOW)).toEqual({ week: "2026-10-12", xp: 6588, shipped: 36, streak: 31, level: 20, badges: [{ icon: "🏅", name: "x" }] });
  });
});

describe("leagueMoves and zoneOf", () => {
  it("moves 7 up and 5 down in a full league, fewer in a small one", () => {
    expect(leagueMoves(30)).toEqual({ up: 7, down: 5 });
    expect(leagueMoves(3)).toEqual({ up: 1, down: 0 });
    expect(leagueMoves(12)).toEqual({ up: 3, down: 2 });
  });

  it("puts the top up and the bottom down, within the ladder", () => {
    expect(zoneOf({ rank: 1, xp: 10 }, 30, 2)).toBe("up");
    expect(zoneOf({ rank: 30, xp: 0 }, 30, 2)).toBe("down");
    expect(zoneOf({ rank: 15, xp: 5 }, 30, 2)).toBeNull();
  });

  it("never moves Gold Thread up, Cotton down, a lone builder or one with no XP up", () => {
    expect(zoneOf({ rank: 1, xp: 10 }, 30, 5)).toBeNull();
    expect(zoneOf({ rank: 30, xp: 0 }, 30, 0)).toBeNull();
    expect(zoneOf({ rank: 1, xp: 10 }, 1, 0)).toBeNull();
    expect(zoneOf({ rank: 1, xp: 0 }, 3, 0)).toBeNull();
  });
});

describe("profileUrl and leagueName", () => {
  it("links to weft.zip/@username", () => {
    expect(profileUrl("fotoflo")).toBe("https://weft.zip/@fotoflo");
    expect(profileUrl("a b")).toBe("https://weft.zip/@a%20b");
    expect(profileUrl(null)).toBeNull();
  });

  it("names a tier, clamped to the ladder", () => {
    expect(leagueName(0)).toBe("Cotton");
    expect(leagueName(5)).toBe("Gold Thread");
    expect(leagueName(9)).toBe("Gold Thread");
    expect(leagueName(-1)).toBe("Cotton");
  });
});

describe("toLeagueView", () => {
  it("reads the standings into rows, with the tier's name and its moves", () => {
    const view = toLeagueView("2026-10-12", [
      row({ badges: [{ icon: "🔥", name: "Streak" }, { icon: 3, name: "bad" }, null] }),
      row({ rank: 2, user_id: "u2", name: "", avatar_url: null, username: null, xp: 0, is_me: false }),
      row({ rank: 3, user_id: "u3", name: null, badges: "nope", is_me: false }),
    ]);
    expect(view).toMatchObject({ state: "ready", week: "2026-10-12", tier: 0, league: "Cotton", up: 1, down: 0 });
    if (view.state !== "ready") throw new Error("not ready");
    expect(view.rows[0]).toEqual({
      rank: 1, userId: "u1", name: "Alex", avatar: "https://a/1.png", username: "fotoflo", xp: 100, shipped: 3, streak: 4, level: 7,
      badges: [{ icon: "🔥", name: "Streak" }], isMe: true,
    });
    expect(view.rows[1]).toMatchObject({ name: "Builder", avatar: null, isMe: false });
    expect(view.rows[2]).toMatchObject({ name: "Builder", badges: [] });
  });

  it("reads the open league: your own tier, each row's tier, and pooled", () => {
    const view = toLeagueView("2026-11-16", [
      row({ user_id: "z", tier: 3, xp: 600, is_me: false, pooled: true }),
      row({ rank: 2, tier: 2, xp: 500, pooled: true }),
    ]);
    expect(view).toMatchObject({ state: "ready", tier: 2, league: "Wool", pooled: true });
    if (view.state !== "ready") throw new Error("not ready");
    expect(view.rows.map((r) => r.tier)).toEqual([3, 2]);
  });

  it("is an empty Cotton league with no rows", () => {
    expect(toLeagueView("2026-10-12", [])).toEqual({ state: "ready", week: "2026-10-12", tier: 0, league: "Cotton", up: 0, down: 0, rows: [] });
  });
});

describe("toTierView", () => {
  const b = (over: Partial<BrowseRow> = {}): BrowseRow => ({ ...row({ is_me: false }), cohort: 0, ...over });

  it("groups a tier into its leagues, yours first, each with its own moves", () => {
    const view = toTierView("2026-10-12", 1, [
      b({ cohort: 0, user_id: "a", rank: 1 }),
      b({ cohort: 0, user_id: "b", rank: 2 }),
      b({ cohort: 1, user_id: "me", rank: 1, is_me: true, badges: [{ icon: "🔥", name: "Hot" }] }),
    ]);
    expect(view).toMatchObject({ state: "ready", week: "2026-10-12", tier: 1, league: "Linen" });
    if (view.state !== "ready") throw new Error("not ready");
    expect(view.leagues.map((l) => l.cohort)).toEqual([1, 0]);
    expect(view.leagues[0]).toMatchObject({ up: 1, down: 0, rows: [{ userId: "me", isMe: true, badges: [{ icon: "🔥", name: "Hot" }] }] });
    expect(view.leagues[1]?.rows.map((r) => r.userId)).toEqual(["a", "b"]);
  });

  it("keeps cohort order when you aren't in the tier, and is empty with nobody there", () => {
    const view = toTierView("2026-10-12", 2, [b({ cohort: 2, user_id: "x" }), b({ cohort: 0, user_id: "y" })]);
    if (view.state !== "ready") throw new Error("not ready");
    expect(view.leagues.map((l) => l.cohort)).toEqual([0, 2]);
    expect(toTierView("2026-10-12", 5, [])).toEqual({ state: "ready", week: "2026-10-12", tier: 5, league: "Gold Thread", leagues: [] });
  });
});
