import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEvent } from "./game";
import type { ProjectReport } from "./project-badges";
import type { Card } from "./types";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-game-"));
const repo = (name: string) => {
  const root = path.join(tmp, name);
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  return root;
};
const A = repo("a");
const B = repo("b");
const C = repo("c");
const plain = path.join(tmp, "plain");
fs.mkdirSync(plain);

const log: ActivityEvent[] = [];
const board: { cards: Card[] } = { cards: [] };
const gitName = { value: "Ada Lovelace" as string | Error };

vi.mock("./activity", () => ({
  trackActivity: vi.fn(),
  readActivity: () => log,
  record: vi.fn((e: Omit<ActivityEvent, "id">) => log.push({ ...e, id: `r${log.length}` })),
}));
vi.mock("./limit-poll", () => ({ startLimitPoll: vi.fn() }));
vi.mock("./store", () => ({ DATA_DIR: "/tmp/weft-game-test-data", listCards: () => board.cards }));
// The first-launch welcome (lib/welcome.ts) gates the activity log: with it unset everything
// counts; with countHistory false, only events and cards after the welcome's at count. The default
// mock models a board that opted in, so the existing tests pass.
const welcomeMock = vi.hoisted(() => ({
  welcome: vi.fn(() => ({ at: 0, countHistory: true, fresh: false, skip: [] })),
  countsAt: vi.fn<(w: unknown, at: number) => boolean>(() => true),
  welcomeOrAdopt: vi.fn(() => ({ at: 0, countHistory: true, fresh: false, skip: [] })),
  importsSession: vi.fn(() => true),
  isScratch: vi.fn(() => false),
  WELCOME_FILE: "",
}));
vi.mock("./welcome", () => welcomeMock);
vi.mock("./usage-scan", () => ({
  scanUsage: vi.fn(() => Promise.reject(new Error("unreadable"))),
  transcriptUsage: () => ({
    tokens: new Map([["2026-10-11", [1000, 200]]]),
    hits: [{ at: new Date(2026, 9, 11, 9).getTime(), kind: "five_hour", reset: "2pm" }],
  }),
}));
vi.mock("./quality", () => ({ projectRoot: (cwd: string) => cwd }));
vi.mock("./import", () => ({ sessionFiles: () => new Map() }));
vi.mock("./craft", () => ({ scanCraft: vi.fn(() => Promise.reject(new Error("unreadable"))), craftHabits: () => new Map() }));
vi.mock("./project-checks", () => ({
  detectStack: vi.fn((root: string) => (root === A ? ["Next.js"] : [])),
  checkProject: vi.fn(
    (root: string): ProjectReport => ({ root, name: path.basename(root), stack: [], ok: {}, score: root === C ? null : 85, coverage: root === A ? 70 : null, perfect: false, clean: true }),
  ),
}));
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => {
    if (gitName.value instanceof Error) throw gitName.value;
    return `${gitName.value}\n`;
  }),
}));

const checks = await import("./project-checks");
const { gameState, rootsToMeasure, REPORT_TTL } = await import("./game-server");

const NOW = new Date(2026, 9, 11, 12).getTime();
const DAY = 24 * 60 * 60 * 1000;

function card(id: string, cwd: string, overrides: Partial<Card> = {}): Card {
  return { id, title: id, prompt: "", cwd, backend: "claude", permissionMode: "default", column: "done", createdAt: NOW - DAY, updatedAt: NOW, ...overrides };
}

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__weftGame;
  log.length = 0;
  gitName.value = "Ada Lovelace";
  vi.mocked(checks.checkProject).mockClear();
  board.cards = [
    card("1", A), card("2", A), card("3", A), card("4", B), card("5", plain), card("6", path.join(tmp, "gone")),
    card("old", C, { createdAt: NOW - 40 * DAY }),
    card("cp", A, { role: "copilot" }),
  ];
  log.push(
    { id: "c1", kind: "created", at: NOW - DAY, card: "1", cwd: A },
    { id: "d1", kind: "done", at: NOW - DAY + 5 * 60_000, card: "1", cwd: A, cost: 0.2, title: "Long Function: Board.tsx" },
    { id: "t1", kind: "turn", at: NOW, card: "2", cwd: A },
  );
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("rootsToMeasure", () => {
  it("picks the busiest repos of the last 30 days and puts the one in view first", () => {
    expect(rootsToMeasure(board.cards, null, NOW)).toEqual([A, B]);
    expect(rootsToMeasure(board.cards, C, NOW)).toEqual([C, A, B]);
    expect(rootsToMeasure(board.cards, A, NOW)).toEqual([A, B]);
    expect(rootsToMeasure(board.cards, plain, NOW)).toEqual([A, B]);
  });
});

describe("gameState", () => {
  it("works from the log alone without measuring when it's the light request", () => {
    const game = gameState({ cwd: A, now: NOW });
    expect(checks.checkProject).not.toHaveBeenCalled();
    expect(game).toMatchObject({ name: "Ada Lovelace", projects: [], inView: null, xp: 2 + 10 + 1 });
    expect(game.streak).toMatchObject({ current: 2 });
    expect(game.today).toEqual({ cards: 0, turns: 1, done: 0, xp: 1 });
    expect(game.skills).toEqual([{ tech: "Next.js", xp: 10, level: 1 }]);
    expect(game.badges.find((b) => b.id === "refactor-5")?.have).toBe(1);
    expect(game.leagues[0]).toBe("Cotton");
  });

  it("measures projects once per TTL and logs one quality snapshot a day", () => {
    const full = gameState({ cwd: C, full: true, now: NOW });
    expect(full.projects.map((p) => p.root)).toEqual([C, A, B]);
    expect(full.inView).toBe(C);
    expect(log.filter((e) => e.kind === "quality").map((e) => [e.cwd, e.coverage])).toEqual([[A, 70], [B, undefined]]);

    gameState({ cwd: C, full: true, now: NOW + 1000 });
    expect(checks.checkProject).toHaveBeenCalledTimes(3);
    gameState({ full: true, now: NOW + REPORT_TTL + 1 });
    expect(checks.checkProject).toHaveBeenCalledTimes(5);
    expect(log.filter((e) => e.kind === "quality")).toHaveLength(2);

    // The light request now uses what's cached.
    expect(gameState({ now: NOW }).projects).toHaveLength(3);
  });

  it("charts the transcripts' tokens and every limit hit, counting a window once", () => {
    log.push(
      { id: `limit:five_hour:${new Date(2026, 9, 11, 11).getTime() / 1000}`, kind: "limit", at: new Date(2026, 9, 11, 10).getTime(), limit: "five_hour" },
      { id: "l2", kind: "limit", at: NOW - 3 * DAY, limit: "seven_day" },
      { id: "l3", kind: "limit", at: NOW },
    );
    const game = gameState({ now: NOW });
    expect(game.usage).toHaveLength(30);
    expect(game.usage.at(-1)).toEqual({ day: "2026-10-11", input: 1000, output: 200, fiveHour: 1, sevenDay: 0 });
    expect(game.usage.at(-4)).toMatchObject({ sevenDay: 1 });
    expect(game.limitHits).toEqual({ fiveHour: 1, sevenDay: 1, fastest: { fiveHour: { ms: 3 * 60 * 60 * 1000, at: new Date(2026, 9, 11, 9).getTime() }, sevenDay: undefined } });
    const unlocked = game.badges.filter((b) => b.group === "Limits" && b.unlocked).map((b) => b.id);
    expect(unlocked).toEqual(["limit-5h", "limit-7d"]);
  });

  it("falls back to the system user name", () => {
    gitName.value = new Error("no git");
    expect(gameState({ now: NOW }).name).toBe(os.userInfo().username);
    delete (globalThis as Record<string, unknown>).__weftGame;
    gitName.value = "";
    expect(gameState({ now: NOW }).name).toBe(os.userInfo().username);
  });

  it("with countHistory off, drops events and cards dated before welcome.at", () => {
    delete (globalThis as Record<string, unknown>).__weftGame;
    const at = NOW - 12 * 60 * 60_000;
    welcomeMock.welcome.mockReturnValue({ at, countHistory: false, fresh: false, skip: [] });
    welcomeMock.countsAt.mockImplementation((w: unknown, t: number) => t >= (w as { at: number }).at);
    const before = { id: "old1", kind: "created" as const, at: NOW - 2 * DAY, card: "x", cwd: A };
    const after = { id: "new1", kind: "created" as const, at: NOW - 60 * 60_000, card: "y", cwd: A };
    log.push(before, after);
    board.cards.push(card("old", A, { createdAt: NOW - 2 * DAY, column: "review" as const }));
    const game = gameState({ now: NOW });
    // Only the after event is in the log; the before card never makes it in because listCards
    // already filtered it out via the same countsAt rule.
    expect(game.records.biggestDay).toEqual({ day: "2026-10-11", cards: 1 });
    // Restore the default for any test that follows.
    welcomeMock.welcome.mockReturnValue({ at: 0, countHistory: true, fresh: false, skip: [] });
    welcomeMock.countsAt.mockReturnValue(true);
  });
});
