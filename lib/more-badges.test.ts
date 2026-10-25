import { describe, expect, it } from "vitest";
import { MORE_DEFS } from "./more-badges";
import { type ActivityEvent } from "./game";
import type { GameFacts } from "./game-badges";
import { type LimitHit } from "./usage";
import { type ProjectReport } from "./project-badges";

const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const test = (id: string) => MORE_DEFS.find((d) => d.id === id)!.test;
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

const CHECK_IDS = ["coverage", "covered80", "guarded", "strict", "slim", "envIgnored", "secretScan", "depBot", "headers",
  "securityMd", "analytics", "errors", "tracing", "logs", "health", "readme", "agentDocs", "architecture", "docsFresh", "license",
  "deploys", "pinned", "lockfile", "upstream"];

function report(root: string, ready = false): ProjectReport {
  const ok = Object.fromEntries(CHECK_IDS.map((id) => [id, ready]));
  return { root, name: root, stack: [], ok, score: null, coverage: null, perfect: ready, clean: ready };
}

describe("more badges", () => {
  it("builds long streak badges with their reached dates", () => {
    expect(test("streak-365")(facts())).toEqual({ unlocked: false, have: 0, need: 365, at: undefined });
    expect(test("streak-365")(facts({ bestStreak: 365 }))).toEqual({ unlocked: true, have: 365, need: 365, at: undefined });
    expect(test("streak-365")(facts({ bestStreak: 365, streakReached: { 365: "2026-10-24" } }))).toEqual({
      unlocked: true, have: 365, need: 365, at: local(24, 12),
    });
    expect(test("streak-1000")(facts({ bestStreak: 1000, streakReached: { 1000: "2026-10-25" } }))).toMatchObject({
      unlocked: true, have: 1000, need: 1000, at: local(25, 12),
    });
  });

  it("recognizes a streak freeze", () => {
    expect(test("saved-by-the-bell")(facts())).toEqual({ unlocked: false, at: undefined });
    expect(test("saved-by-the-bell")(facts({ frozen: ["2026-10-25", "2026-10-24"] }))).toEqual({
      unlocked: true, at: local(24, 12),
    });
  });

  it("recognizes seven consecutive ship days", () => {
    const week = Array.from({ length: 7 }, (_, i) => event("done", local(18 + i, 9), { card: `c${i}` }));
    expect(test("perfect-week")(facts({ events: week }))).toEqual({ unlocked: true, at: local(24, 9) });
    const gap = week.filter((_, i) => i !== 5);
    expect(test("perfect-week")(facts({ events: gap }))).toEqual({ unlocked: false });
    expect(test("perfect-week")(facts({ events: week.slice(0, 5) }))).toEqual({ unlocked: false });
    const twice = [...week, event("done", local(24, 10), { card: "extra" })];
    expect(test("perfect-week")(facts({ events: twice }))).toEqual({ unlocked: true, at: local(24, 9) });
  });

  it("counts projects and production-ready projects", () => {
    expect(test("cartographer-10")(facts({ projectCount: 10 }))).toMatchObject({ unlocked: true, have: 10, need: 10 });
    expect(test("cartographer-25")(facts({ projectCount: 24 }))).toMatchObject({ unlocked: false, have: 24, need: 25 });
    expect(test("fleet-ready")(facts({ projects: [report("a", true), report("b", true), report("c", true)] }))).toMatchObject({
      unlocked: true, have: 3, need: 3,
    });
    expect(test("fleet-ready")(facts({ projects: [report("a", true)] }))).toMatchObject({ unlocked: false, have: 1, need: 3 });
  });

  it("finds a project that shipped ten cards on its first-card day", () => {
    const roots = new Map([["/cards/a", "/project/a"]]);
    const events = [event("created", local(24, 8), { cwd: "/cards/a" })];
    for (let i = 0; i < 10; i++) events.push(event("done", local(24, 9 + i / 10), { card: `c${i}`, cwd: "/cards/a" }));
    expect(test("big-bang")(facts({ events, roots }))).toEqual({ unlocked: true, at: events[10]?.at });
    const later = events.map((e) => (e.kind === "done" ? { ...e, at: local(25, 9) } : e));
    expect(test("big-bang")(facts({ events: later, roots }))).toEqual({ unlocked: false, at: undefined });
    const noCwd = events.map((e) => ({ ...e, cwd: undefined }));
    expect(test("big-bang")(facts({ events: noCwd }))).toEqual({ unlocked: false, at: undefined });
  });

  it("falls back to the card folder when a project root is unknown", () => {
    const roots = new Map([["/cards/a", "/project/a"]]);
    const events = [event("created", local(24, 8), { cwd: "/cards/b" })];
    for (let i = 0; i < 10; i++) events.push(event("done", local(24, 9 + i / 10), { card: `c${i}`, cwd: "/cards/b" }));
    expect(test("big-bang")(facts({ events, roots }))).toEqual({ unlocked: true, at: events[10]?.at });
  });

  it("finds no big bang in a project that shipped nothing", () => {
    const events = [event("created", local(24, 8), { cwd: "/cards/a" })];
    expect(test("big-bang")(facts({ events }))).toEqual({ unlocked: false, at: undefined });
  });

  it("counts two cards created in one project", () => {
    const roots = new Map([["/cards/a", "/project/a"]]);
    const events = [event("created", local(24, 8), { cwd: "/cards/a" }), event("created", local(24, 8, 30), { cwd: "/cards/a" })];
    for (let i = 0; i < 10; i++) events.push(event("done", local(24, 9 + i / 10), { card: `c${i}`, cwd: "/cards/a" }));
    expect(test("big-bang")(facts({ events, roots }))).toEqual({ unlocked: true, at: events[11]?.at });
  });

  it("finds a project that shipped ten cards on its first-card day without a roots map", () => {
    const events = [event("created", local(24, 8), { cwd: "/cards/a" })];
    for (let i = 0; i < 10; i++) events.push(event("done", local(24, 9 + i / 10), { card: `c${i}`, cwd: "/cards/a" }));
    expect(test("big-bang")(facts({ events }))).toEqual({ unlocked: true, at: events[10]?.at });
  });

  it("finds a project that shipped ten cards on its first-card day without a roots map", () => {
    const events = [event("created", local(24, 8), { cwd: "/cards/a" })];
    for (let i = 0; i < 10; i++) events.push(event("done", local(24, 9 + i / 10), { card: `c${i}`, cwd: "/cards/a" }));
    expect(test("big-bang")(facts({ events }))).toEqual({ unlocked: true, at: events[10]?.at });
  });

  it("counts shipped stacks", () => {
    expect(test("stack-collector")(facts({ shippedStacks: 5 }))).toMatchObject({ unlocked: true, have: 5, need: 5 });
    expect(test("stack-collector")(facts())).toMatchObject({ unlocked: false, have: 0, need: 5 });
  });

  it("recognizes a week of 69 ships", () => {
    const events = Array.from({ length: 69 }, (_, i) => event("done", local(19, 8) + i * 60_000, { card: `c${i}` }));
    expect(test("nice")(facts({ events }))).toEqual({ unlocked: true, at: local(19, 8) + 68 * 60_000 });
    expect(test("nice")(facts({ events: events.slice(0, 68) }))).toEqual({ unlocked: false, at: undefined });
  });

  it("recognizes a ship at 4:20", () => {
    expect(test("blaze-it")(facts({ events: [event("done", local(19, 4, 20), { card: "x" })] }))).toEqual({
      unlocked: true, at: local(19, 4, 20),
    });
    expect(test("blaze-it")(facts({ events: [event("done", local(19, 16, 20), { card: "x" })] }))).toEqual({
      unlocked: true, at: local(19, 16, 20),
    });
    expect(test("blaze-it")(facts({ events: [event("done", local(19, 5, 20), { card: "x" })] }))).toEqual({
      unlocked: false, at: undefined,
    });
  });

  it("recognizes 42 ships in a day", () => {
    const day = Array.from({ length: 42 }, (_, i) => event("done", local(19, 8) + i * 60_000, { card: `d${i}` }));
    expect(test("the-answer")(facts({ events: day }))).toEqual({ unlocked: true, at: local(19, 8) + 41 * 60_000 });
    expect(test("the-answer")(facts({ events: day.slice(0, 41) }))).toMatchObject({ unlocked: false });
  });

  it("recognizes a shipped typo fix", () => {
    expect(test("typo-slayer")(facts({ events: [event("done", local(19, 9), { card: "x", title: "Fix typo in README" })] }))).toEqual({
      unlocked: true, at: local(19, 9),
    });
    expect(test("typo-slayer")(facts({ events: [event("done", local(19, 9), { card: "x" })] }))).toEqual({
      unlocked: false, at: undefined,
    });
  });

  it("hides the secret badges until they're earned", () => {
    const secrets = MORE_DEFS.filter((d) => d.group === "Secret");
    expect(secrets.map((d) => d.id)).toEqual(["nice", "blaze-it", "the-answer", "typo-slayer"]);
    expect(secrets.every((d) => d.secret)).toBe(true);
  });

  it("recognizes shipping three cards after a limit hit", () => {
    const hits: LimitHit[] = [{ at: local(19, 8), kind: "five_hour" }];
    const events = [event("done", local(19, 9), { card: "a" }), event("done", local(19, 10), { card: "b" }),
      event("done", local(19, 11), { card: "c" })];
    expect(test("undeterred")(facts({ events, limitHits: hits }))).toEqual({ unlocked: true, at: local(19, 11) });
    expect(test("undeterred")(facts({ events: events.slice(0, 2), limitHits: hits }))).toEqual({ unlocked: false, at: undefined });
    expect(test("undeterred")(facts({ events }))).toEqual({ unlocked: false, at: undefined });
    const twoHits: LimitHit[] = [{ at: local(19, 12), kind: "five_hour" }, { at: local(19, 7), kind: "seven_day" }];
    expect(test("undeterred")(facts({ events, limitHits: twoHits }))).toEqual({ unlocked: true, at: local(19, 11) });
  });
});
