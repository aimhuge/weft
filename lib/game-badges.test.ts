import { describe, expect, it } from "vitest";
import type { ActivityEvent, Records } from "./game";
import { badges, coverageClimbed, fixFor, isRefactor, toAnnounce, type Badge, type GameFacts } from "./game-badges";
import { CHECKS, type ProjectReport } from "./project-badges";

const noRecords: Records = { biggestDay: null, mostShipped: null, maxRunning: 0, fastest: null, cheapest: null };
const allOk = Object.fromEntries(CHECKS.map((c) => [c.id, true]));

function project(overrides: Partial<ProjectReport> = {}): ProjectReport {
  return { root: "/dev/app", name: "app", stack: [], ok: {}, score: 50, coverage: null, perfect: false, clean: false, ...overrides };
}

function facts(overrides: Partial<GameFacts> = {}): GameFacts {
  return { events: [], bestStreak: 0, records: noRecords, projects: [], projectCount: 0, refactors: 0, climbed: false, ...overrides };
}

const ev = (kind: ActivityEvent["kind"], at: number, extra: Partial<ActivityEvent> = {}): ActivityEvent => ({ id: `${kind}${at}`, kind, at, ...extra });
const byId = (list: Badge[]) => new Map(list.map((b) => [b.id, b]));

describe("badges", () => {
  it("starts with everything locked and progress at zero", () => {
    const list = byId(badges(facts()));
    expect([...list.values()].every((b) => !b.unlocked)).toBe(true);
    expect(list.get("cards-10")).toMatchObject({ have: 0, need: 10, at: undefined });
  });

  it("dates counted badges by the event that earned them", () => {
    const events = Array.from({ length: 12 }, (_, i) => ev("created", 1000 + i)).reverse();
    const list = byId(badges(facts({ events })));
    expect(list.get("first-card")).toMatchObject({ unlocked: true, at: 1000 });
    expect(list.get("cards-10")).toMatchObject({ unlocked: true, at: 1009, have: 10 });
    expect(list.get("cards-100")).toMatchObject({ unlocked: false, have: 12 });
  });

  it("reads streaks, records and habits", () => {
    const night = new Date(2026, 9, 11, 2).getTime();
    const morning = new Date(2026, 9, 11, 6).getTime();
    const list = byId(
      badges(
        facts({
          bestStreak: 8,
          streakReached: { 3: "2026-10-01", 7: "2026-10-05" },
          events: [ev("turn", night), ev("done", morning), ev("created", morning)],
          records: { ...noRecords, maxRunning: 6, biggestDay: { day: "d", cards: 30 }, cheapest: 0.3 },
          projectCount: 5,
          refactors: 6,
          climbed: true,
        }),
      ),
    );
    for (const id of ["streak-7", "parallel-5", "big-day", "night-owl", "early-bird", "polymath", "thrifty", "refactor-5", "climber"]) {
      expect(list.get(id)?.unlocked, id).toBe(true);
    }
    expect(list.get("night-owl")?.at).toBe(night);
    expect(list.get("streak-7")?.at).toBe(new Date(2026, 9, 5, 12).getTime());
    expect(list.get("streak-30")?.at).toBeUndefined();
    for (const id of ["streak-30", "parallel-10", "huge-day", "refactor-25"]) expect(list.get(id)?.unlocked, id).toBe(false);
  });

  it("unlocks code health and production-ready badges from any project", () => {
    const list = byId(
      badges(facts({ projects: [project(), project({ ok: allOk, coverage: 100, perfect: true, clean: true })] })),
    );
    for (const id of ["tested", "covered-80", "covered-95", "covered-100", "guarded", "strict", "slim", "clean-tree", "perfect", "branch-security", "production-ready"]) {
      expect(list.get(id)?.unlocked, id).toBe(true);
    }
  });
});

describe("isRefactor", () => {
  it("knows scout cards and refactor titles", () => {
    expect(isRefactor("Long Function: Board.tsx")).toBe(true);
    expect(isRefactor("Refactor the runner")).toBe(true);
    expect(isRefactor("Add dark mode")).toBe(false);
    expect(isRefactor()).toBe(false);
  });
});

describe("coverageClimbed", () => {
  const day = 24 * 60 * 60 * 1000;
  const q = (at: number, coverage?: number, cwd = "/a"): ActivityEvent => ({ id: `q${at}${cwd}`, kind: "quality", at, cwd, coverage });
  it("needs 10 points in one project within a week", () => {
    expect(coverageClimbed([q(0, 50), q(3 * day, 61)])).toBe(true);
    expect(coverageClimbed([q(0, 50), q(8 * day, 70)])).toBe(false);
    expect(coverageClimbed([q(0, 50), q(day, 70, "/b")])).toBe(false);
    expect(coverageClimbed([q(0, 50), q(day, 55), q(2 * day)])).toBe(false);
  });
});

describe("fixFor", () => {
  const all = byId(badges(facts()));
  const get = (id: string) => all.get(id) as Badge;
  it("offers the badge's own check while it fails, else its branch's first failing check", () => {
    expect(fixFor(get("guarded"), project())?.id).toBe("guarded");
    expect(fixFor(get("covered-95"), project({ ok: { covered80: true } }))?.id).toBe("coverage");
    expect(fixFor(get("branch-security"), project())?.id).toBe("envIgnored");
  });

  it("offers nothing when unlocked, without a fix, a project, or anything left", () => {
    expect(fixFor({ ...get("guarded"), unlocked: true }, project())).toBeNull();
    expect(fixFor(get("streak-3"), project())).toBeNull();
    expect(fixFor(get("guarded"), null)).toBeNull();
    expect(fixFor(get("branch-docs"), project({ ok: allOk }))).toBeNull();
  });
});

describe("toAnnounce", () => {
  const b = (id: string, unlocked: boolean): Badge => ({ id, icon: "🏅", name: id, desc: "", group: "Habits", unlocked });
  it("stays quiet on the first load", () => {
    expect(toAnnounce(null, [b("a", true), b("b", false)], 3)).toEqual({ next: { badges: ["a"], level: 3 }, text: null, fresh: [], levelUp: null });
  });

  it("announces one badge, several, and level-ups", () => {
    const prev = { badges: ["a"], level: 3 };
    expect(toAnnounce(prev, [b("a", true)], 3).text).toBeNull();
    expect(toAnnounce(prev, [b("a", true), b("x", true)], 3).text).toBe("🏅 Badge unlocked: 🏅 x");
    const many = toAnnounce(prev, ["w", "x", "y", "z"].map((id) => b(id, true)), 4);
    expect(many.text).toBe("⬆️ Level 4 · 🏅 4 badges unlocked: 🏅 w, 🏅 x, 🏅 y…");
    expect(many.next).toEqual({ badges: ["a", "w", "x", "y", "z"], level: 4 });
    expect(toAnnounce(prev, [b("x", true), b("y", true)], 2).text).toBe("🏅 2 badges unlocked: 🏅 x, 🏅 y");
  });

  it("hands back the fresh badges and the new level for the popup", () => {
    const prev = { badges: ["a"], level: 3 };
    expect(toAnnounce(null, [b("a", true)], 3)).toMatchObject({ fresh: [], levelUp: null });
    const got = toAnnounce(prev, [b("a", true), b("x", true), b("y", false)], 4);
    expect(got.fresh.map((x) => x.id)).toEqual(["x"]);
    expect(got.levelUp).toBe(4);
    expect(toAnnounce(prev, [b("a", true)], 3)).toMatchObject({ fresh: [], levelUp: null });
  });
});

describe("limit badges", () => {
  it("unlock with the first hit of each window", () => {
    const list = byId(badges(facts({ limitHits: [{ at: 5, kind: "five_hour" }, { at: 9, kind: "five_hour" }] })));
    expect(list.get("limit-5h")).toMatchObject({ unlocked: true, at: 5 });
    expect(list.get("limit-7d")).toMatchObject({ unlocked: false, at: undefined });
    expect(byId(badges(facts({ limitHits: [{ at: 7, kind: "seven_day" }] }))).get("limit-7d")).toMatchObject({ unlocked: true, at: 7 });
  });

  it("file under Limits and read no hits as none", () => {
    const list = byId(badges(facts({ limitHits: undefined })));
    expect(list.get("limit-5h-2")).toMatchObject({ group: "Limits", unlocked: false, have: 0, need: 2 });
  });
});
