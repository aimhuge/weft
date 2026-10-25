import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Seed } from "./project-seed";
import type { Card } from "./types";

const h = vi.hoisted(() => ({
  dir: "",
  cards: [] as Card[],
  addCards: vi.fn((cs: Card[]) => void h.cards.push(...cs)),
  applyIssues: vi.fn(() => ({ added: 1, updated: 0, archived: 0 })),
  projects: [] as { path: string; lastUsedAt: number }[],
  handlers: new Map<string, (f: string) => void>(),
}));
vi.mock("./store", () => ({ get DATA_DIR() { return h.dir; }, listCards: () => h.cards, addCards: h.addCards }));
vi.mock("./github-issues", () => ({ applyIssues: h.applyIssues }));
vi.mock("./settings", () => ({ defaultBackend: () => "claude", defaultPermissionMode: () => "default", listProjects: () => h.projects }));
vi.mock("./project-open", () => ({ onProjectOpen: (n: string, f: (x: string) => void) => h.handlers.set(n, f) }));
vi.mock("./project-seed-find", () => ({ FIND_DEPS: {}, findSeeds: vi.fn() }));

let mod: typeof import("./project-seed-run");
let find: typeof import("./project-seed-find");
let folder: string;
const g = globalThis as unknown as { __weftProjectSeed?: unknown };
const seeds: Seed[] = [
  { kind: "agents", title: "Set up p for agents", prompt: "init" },
  { kind: "issue", title: "Bug", prompt: "", issue: { repo: "o/r", issue: { number: 3, title: "Bug", url: "u", state: "OPEN", updatedAt: "t" } } },
  { kind: "todo", title: "Clear the TODOs in a.ts", prompt: "todo" },
];
const deps = () => ({ cards: () => h.cards }) as never;

beforeEach(async () => {
  h.dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-seed-run-"));
  folder = path.join(h.dir, "p");
  fs.mkdirSync(folder);
  h.cards = [];
  h.projects = [];
  h.handlers.clear();
  h.addCards.mockClear();
  h.applyIssues.mockClear();
  vi.resetModules();
  delete g.__weftProjectSeed;
  mod = await import("./project-seed-run");
  find = await import("./project-seed-find");
  vi.mocked(find.findSeeds).mockReset().mockResolvedValue(seeds);
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(h.dir, { recursive: true, force: true });
});

describe("seedProject", () => {
  it("parks the seeds as Backlog cards once, issues through the importer", async () => {
    expect(await mod.seedProject(folder)).toBe(3);
    expect(h.applyIssues).toHaveBeenCalledWith(folder, "o/r", [seeds[1]?.issue?.issue]);
    expect(h.cards.map((c) => [c.title, c.column, c.cwd, c.backend, c.titleBy])).toEqual([
      ["Set up p for agents", "backlog", folder, "claude", "user"],
      ["Clear the TODOs in a.ts", "backlog", folder, "claude", "user"],
    ]);
    expect(mod.readSeeded()?.[folder]).toBeGreaterThan(0);
    expect(await mod.seedProject(folder)).toBe(0);
  });

  it("re-seeds when forced, skipping cards already on the board", async () => {
    mod.markSeeded(folder);
    h.cards = [{ title: "set up p for agents", cwd: `${folder}/sub` } as Card, { title: "Clear the TODOs in a.ts", cwd: "/elsewhere" } as Card];
    vi.mocked(find.findSeeds).mockResolvedValue([seeds[0]!, seeds[2]!]);
    expect(await mod.seedProject(folder, { force: true })).toBe(1);
    expect(h.addCards).toHaveBeenCalledOnce();
  });

  it("adds nothing for a folder that's gone, or with nothing to say", async () => {
    expect(await mod.seedProject(path.join(h.dir, "gone"))).toBe(0);
    vi.mocked(find.findSeeds).mockResolvedValue([]);
    expect(await mod.seedProject(folder)).toBe(0);
    expect(h.addCards).not.toHaveBeenCalled();
  });

  it("shares one run per folder", async () => {
    const a = mod.seedProject(folder);
    expect(mod.seedProject(folder)).toBe(a);
    await a;
  });
});

describe("readSeeded", () => {
  it("is null before the file exists and empty for a file without the key", () => {
    expect(mod.readSeeded()).toBeNull();
    fs.writeFileSync(path.join(h.dir, "project-seeds.json"), "{}");
    expect(mod.readSeeded()).toEqual({});
  });
});

describe("startProjectSeed", () => {
  it("counts the projects already on the board as seeded, then seeds a new one after a delay", async () => {
    vi.useFakeTimers();
    h.projects = [{ path: "/old", lastUsedAt: 1 }];
    mod.startProjectSeed();
    expect(mod.readSeeded()).toEqual({ "/old": 0 });
    h.projects = [];
    mod.startProjectSeed();
    expect(mod.readSeeded()).toEqual({ "/old": 0 });
    h.handlers.get("seed")?.(folder);
    expect(h.addCards).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.addCards).toHaveBeenCalledOnce();
  });

  it("logs a seed that fails", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(find.findSeeds).mockRejectedValue(new Error("boom"));
    mod.startProjectSeed();
    h.handlers.get("seed")?.(folder);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("seeding"), expect.any(Error));
    warn.mockRestore();
  });
});

describe("seedChipLines", () => {
  it("lists what each project would get, minus the board, cached", async () => {
    h.cards = [{ title: "Bug", cwd: folder, issue: { repo: "o/r", number: 3, url: "", state: "open", updatedAt: "" } } as Card];
    expect(await mod.seedChipLines([folder], deps())).toEqual(['- p: starter card "Set up p for agents" (agents)', '- p: starter card "Clear the TODOs in a.ts" (todo)']);
    await mod.seedChipLines([folder], deps());
    expect(find.findSeeds).toHaveBeenCalledOnce();
  });

  it("drops a failed look from the cache", async () => {
    vi.mocked(find.findSeeds).mockRejectedValueOnce(new Error("x"));
    await expect(mod.seedChipLines([folder], deps())).rejects.toThrow("x");
    expect(await mod.seedChipLines([folder], deps())).toHaveLength(3);
  });

  it("asks again once the cache is ten minutes old", async () => {
    await mod.seedChipLines([folder], deps());
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 11 * 60_000);
    await mod.seedChipLines([folder], deps());
    expect(find.findSeeds).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
});
