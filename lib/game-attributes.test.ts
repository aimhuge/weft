import { describe, expect, it } from "vitest";
import type { Habit } from "./craft";
import type { ActivityEvent, DayTally } from "./game";
import { attributes, classFor, stackSkills, type Attribute, type AttributeInput } from "./game-attributes";
import { CHECKS, type ProjectReport } from "./project-badges";

const ev = (kind: ActivityEvent["kind"], card: string, extra: Partial<ActivityEvent> = {}): ActivityEvent => ({ id: `${kind}${card}`, kind, at: 1, card, cwd: "/a", ...extra });
const day = (d: Partial<DayTally>): DayTally => ({ cards: 0, turns: 0, done: 0, xp: 0, ...d });

function input(overrides: Partial<AttributeInput> = {}): AttributeInput {
  return { events: [], days: new Map(), today: "2026-10-11", bestStreak: 0, projects: [], projectCount: 0, stacks: 0, habits: new Map(), ...overrides };
}

const value = (list: Attribute[], id: Attribute["id"]) => list.find((a) => a.id === id)?.value;

describe("attributes", () => {
  it("is zeros with no history", () => {
    const list = attributes(input());
    expect(list.map((a) => a.value)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(list.find((a) => a.id === "craft")?.hint).toBe("0/0 ran /done · review 0 · docs 0 · refactor 0");
  });

  it("counts each created card once toward follow-through", () => {
    const events = [ev("created", "a"), ev("created", "b"), ev("done", "a"), { ...ev("done", "a"), id: "done-a-again" }, ev("done", "x")];
    const list = attributes(input({ events }));
    expect(value(list, "follow")).toBe(50);
    expect(list.find((a) => a.id === "follow")?.hint).toBe("1 of 2 cards reached Done");
  });

  it("measures follow-through, velocity, range, craft and stamina", () => {
    const events = [
      ev("created", "a"), ev("created", "b"), ev("created", "c"), ev("created", "d"),
      ev("done", "a", { cost: 0.1, title: "Refactor the store" }),
      ev("done", "b", { cost: 0.1 }),
      ev("done", "c"),
    ];
    const days = new Map([
      ["2026-10-11", day({ done: 2, cards: 1 })],
      ["2026-10-10", day({ done: 1 })],
      ["2026-09-01", day({ done: 9 })],
    ]);
    const habits = new Map<string, ReadonlySet<Habit>>([
      ["a", new Set<Habit>(["wrap", "commit"])],
      ["b", new Set<Habit>(["wrap", "commit", "review"])],
      ["z", new Set<Habit>(["docs"])],
    ]);
    const list = attributes(input({ events, days, bestStreak: 30, projectCount: 4, stacks: 5, habits }));
    expect(value(list, "follow")).toBe(75);
    expect(list.find((a) => a.id === "follow")?.hint).toBe("3 of 4 cards reached Done");
    expect(value(list, "velocity")).toBe(15);
    expect(value(list, "range")).toBe(39);
    // 2 of 3 wrapped and committed (26.7 of 40, 10 of 15), 1 reviewed and 1 refactor by title (past 1 in 5
    // and 1 in 10: 15 each), no docs (z never shipped).
    expect(value(list, "craft")).toBe(67);
    expect(list.find((a) => a.id === "craft")?.hint).toBe("2/3 ran /done · review 1 · docs 0 · refactor 1");
    expect(value(list, "stamina")).toBe(Math.round((2 / 30) * 80 + 20));
  });

  it("gives craft in full for every habit, and nothing to a shipped card it can't place", () => {
    const all = new Set<Habit>(["wrap", "commit", "review", "docs", "refactor"]);
    const events = [ev("done", "a"), { ...ev("done", "lost"), card: undefined }];
    expect(value(attributes(input({ events: events.slice(0, 1), habits: new Map([["a", all]]) })), "craft")).toBe(100);
    // Half the cards: half of /done and commit, but 1 in 2 is past the share review, docs and refactor need.
    expect(value(attributes(input({ events, habits: new Map([["a", all]]) })), "craft")).toBe(73);
  });

  it("scores rigor and guard from the projects' trees", () => {
    const testing = Object.fromEntries(CHECKS.filter((c) => c.branch === "testing").map((c) => [c.id, true]));
    const p = (ok: Record<string, boolean>): ProjectReport => ({ root: "/a", name: "a", stack: [], ok, score: 0, coverage: null, perfect: false, clean: false });
    const list = attributes(input({ projects: [p(testing), p({ envIgnored: true })] }));
    expect(value(list, "rigor")).toBe(50);
    expect(value(list, "guard")).toBe(5);
  });
});

describe("classFor", () => {
  const a = (id: Attribute["id"], v: number): Attribute => ({ id, icon: "", label: id, value: v, hint: "" });
  it("names the best attribute after the second best's adjective", () => {
    expect(classFor([a("follow", 90), a("velocity", 80), a("guard", 10)])).toBe("Swift Finisher");
    expect(classFor([a("guard", 90)])).toBe("Guardian");
    expect(classFor([])).toBe("Apprentice");
  });
});

describe("stackSkills", () => {
  it("gives each shipped card's XP to its project's stack", () => {
    const events = [ev("done", "a"), ev("done", "b"), ev("done", "c", { cwd: "/b" }), ev("done", "d", { cwd: undefined }), ev("created", "e")];
    const skills = stackSkills(events, (cwd) => (cwd === "/a" ? ["Next.js", "Supabase"] : ["Electron"]));
    expect(skills).toEqual([
      { tech: "Next.js", xp: 20, level: 1 },
      { tech: "Supabase", xp: 20, level: 1 },
      { tech: "Electron", xp: 10, level: 1 },
    ]);
  });
});
