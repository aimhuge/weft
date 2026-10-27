import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, ThreadItem } from "./types";

const h = vi.hoisted(() => ({
  thread: [] as ThreadItem[],
  dropped: [] as number[],
  sent: [] as { text: string; cli: string }[],
  scout: null as null | { findings: { id: string; file: string; line?: number; smell: string; fix: string }[]; started: string[] },
}));

vi.mock("./store", () => ({
  DATA_DIR: "/tmp",
  getThread: () => h.thread,
  dropThreadFrom: (_id: string, from: number) => {
    h.dropped.push(from);
    h.thread = h.thread.slice(0, from);
  },
  listCards: () => [],
}));
vi.mock("./copilot-sources", () => ({ activeProjects: (cards: Card[]) => [...new Set(cards.map((c) => c.cwd))] }));
vi.mock("./scout", () => ({ readScout: () => h.scout }));
vi.mock("./runner", () => ({ sendUserMessage: (_id: string, text: string, opts: { cli: string }) => h.sent.push({ text, cli: opts.cli }) }));

const { publish } = await import("./bus");
const run = await import("./copilot-initiative-run");

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-checkin-"));
  file = path.join(dir, "state.json");
  h.thread = [];
  h.dropped = [];
  h.sent = [];
  h.scout = null;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const card = (over: Partial<Card>): Card => ({
  id: "c",
  title: "t",
  prompt: "",
  cwd: "/dev/weft",
  backend: "claude",
  permissionMode: "default",
  column: "running",
  createdAt: 0,
  updatedAt: 0,
  ...over,
});
const at = (h: number, m = 0) => new Date(2026, 9, 27, h, m);

// A git that answers rev-parse from `heads` and log from `log`.
function fakeGit(heads: Record<string, string>, log = "") {
  return vi.fn((cwd: string, args: string[]) => Promise.resolve(args[0] === "rev-parse" ? (heads[cwd] ?? "") : log));
}

describe("state and the switch", () => {
  it("reads an empty state from a missing or broken file", () => {
    expect(run.readState(file)).toMatchObject({ count: 0, heads: {} });
    fs.writeFileSync(file, "{");
    expect(run.readState(file)).toMatchObject({ count: 0 });
  });

  it("is on by default and remembers being turned off and on", () => {
    expect(run.checkInsOn(file)).toBe(true);
    run.setCheckInsOn(false, file);
    expect(run.checkInsOn(file)).toBe(false);
    run.setCheckInsOn(true, file);
    expect(run.checkInsOn(file)).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).not.toHaveProperty("off");
  });
});

describe("tick", () => {
  it("sends the morning check-in when you're at work, once a day", async () => {
    const now = at(9);
    const send = vi.fn();
    const cards = () => [card({ lastActivity: now.getTime() - 60_000 })];
    const deps = { now: () => now, cards, send, git: fakeGit({ "/dev/weft": "h1" }), file };
    expect(await run.tick(deps)).toBe("morning");
    const [text, { cli }] = send.mock.calls[0] as [string, { cli: string }];
    expect(text).toBe("☀️ Morning check-in");
    expect(cli).toContain("Projects: weft.");
    expect(run.readState(file)).toMatchObject({ count: 1, morningDay: "2026-10-27", heads: { "/dev/weft": "h1" } });
    const later = at(12);
    expect(await run.tick({ ...deps, now: () => later })).toBeNull();
  });

  it("sends nothing while blocked, but still records what it saw", async () => {
    const send = vi.fn();
    expect(await run.tick({ now: () => at(23), cards: () => [card({ lastActivity: at(23).getTime() })], send, git: fakeGit({ "/dev/weft": "h1" }), file })).toBeNull();
    expect(send).not.toHaveBeenCalled();
    expect(run.readState(file).heads).toEqual({ "/dev/weft": "h1" });
  });

  it("sends a refactor check-in once work that landed has settled", async () => {
    run.writeState({ day: "2026-10-27", count: 0, lastAt: 0, morningDay: "2026-10-27", heads: { "/dev/weft": "h1" }, moved: { "/dev/weft": { head: "h2", at: at(9).getTime() } } }, file);
    h.scout = { findings: [{ id: "f1", file: "/dev/weft/lib/a.ts", line: 3, smell: "Long Function", fix: "Split it" }, { id: "f2", file: "/dev/weft/b.ts", smell: "Dup", fix: "Merge" }], started: ["f2"] };
    const send = vi.fn();
    const git = fakeGit({ "/dev/weft": "h2" }, "feat(board): fold columns\ndocs(changelog): x\n");
    expect(await run.tick({ now: () => at(10), cards: () => [card({})], send, git, file })).toBe("landed");
    expect(git).toHaveBeenCalledWith("/dev/weft", ["log", "--format=%s", "-n", "15", "h1..h2"]);
    const [text, { cli }] = send.mock.calls[0] as [string, { cli: string }];
    expect(text).toBe("🔧 Refactor check-in: weft");
    expect(cli).toContain("- feat(board): fold columns");
    expect(cli).not.toContain("changelog");
    expect(cli).toContain("- a.ts:3 Long Function: Split it");
    expect(cli).not.toContain("Dup");
    expect(run.readState(file)).toMatchObject({ count: 1, heads: { "/dev/weft": "h2" }, moved: {} });
  });

  it("leaves the scout out when the project has none", async () => {
    run.writeState({ ...run.readState(file), morningDay: "2026-10-27", heads: { "/dev/weft": "h1" }, moved: { "/dev/weft": { head: "h2", at: 0 } } }, file);
    const send = vi.fn();
    await run.tick({ now: () => at(10), cards: () => [card({})], send, git: fakeGit({ "/dev/weft": "h2" }, "fix: y"), file });
    expect((send.mock.calls[0] as [string, { cli: string }])[1].cli).not.toContain("scout findings");
  });

  it("moves the baseline without a check-in when only bookkeeping landed", async () => {
    run.writeState({ day: "", count: 0, lastAt: 0, morningDay: "2026-10-27", heads: { "/dev/weft": "h1" }, moved: { "/dev/weft": { head: "h2", at: 0 } } }, file);
    const send = vi.fn();
    expect(await run.tick({ now: () => at(10), cards: () => [card({})], send, git: fakeGit({ "/dev/weft": "h2" }, "chore(release): 0.6.3"), file })).toBeNull();
    expect(send).not.toHaveBeenCalled();
    expect(run.readState(file).heads).toEqual({ "/dev/weft": "h2" });
  });

  it("sends through the runner by default", async () => {
    const now = at(9);
    await run.tick({ now: () => now, cards: () => [card({ lastActivity: now.getTime() })], git: fakeGit({}), file });
    await vi.waitFor(() => expect(h.sent).toHaveLength(1));
    expect(h.sent[0]?.text).toBe("☀️ Morning check-in");
  });
});

describe("defaults", () => {
  it("reads git, and gives nothing for a folder that isn't a repo", async () => {
    const repo = path.join(dir, "repo");
    fs.mkdirSync(repo);
    expect(await run.git(repo, ["rev-parse", "HEAD"])).toBe("");
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x"], { cwd: repo });
    expect(await run.git(repo, ["log", "--format=%s"])).toBe("x");
  });

  it("ticks on the board's own cards and clock", async () => {
    expect(await run.tick({ file })).toBeNull();
    expect(run.readState(file).day).not.toBe("");
  });

  it("dates your last activity by updatedAt when a card has no lastActivity, and lists a finding without a line", async () => {
    const now = at(9);
    h.scout = { findings: [{ id: "f", file: "/dev/weft/x.ts", smell: "Dup", fix: "Merge" }], started: [] };
    const send = vi.fn();
    run.writeState({ ...run.readState(file), morningDay: "2026-10-27", heads: { "/dev/weft": "h1" }, moved: { "/dev/weft": { head: "h2", at: 0 } } }, file);
    await run.tick({ now: () => now, cards: () => [card({ updatedAt: now.getTime() })], send, git: fakeGit({ "/dev/weft": "h2" }, "feat: x"), file });
    expect((send.mock.calls[0] as [string, { cli: string }])[1].cli).toContain("- x.ts Dup: Merge");
  });
});

describe("watchForQuiet", () => {
  const copilot = (column: Card["column"]) => publish({ type: "card", card: card({ id: "copilot", column }) });

  it("takes a QUIET check-in and its answer back out of the thread", () => {
    h.thread = [{ kind: "user", text: "earlier", at: 1 }];
    run.watchForQuiet(1);
    h.thread.push({ kind: "user", text: "☀️ Morning check-in", at: 2 });
    copilot("running");
    publish({ type: "card", card: card({ id: "other", column: "review" }) });
    h.thread.push({ kind: "assistant", text: "QUIET\nBOARD STATUS: column=review", at: 3 });
    copilot("review");
    expect(h.dropped).toEqual([1]);
    copilot("review");
    expect(h.dropped).toEqual([1]);
  });

  it("keeps a check-in with something to say", () => {
    run.watchForQuiet(0);
    h.thread.push({ kind: "user", text: "☀️ Morning check-in", at: 2 });
    copilot("review");
    h.thread.push({ kind: "assistant", text: "Build the diff view next.", at: 3 });
    copilot("review");
    expect(h.dropped).toEqual([]);
  });

  it("leaves the thread alone once you've written after it, or the wait runs out", () => {
    run.watchForQuiet(0);
    h.thread.push({ kind: "user", text: "☀️ Morning check-in", at: 2 }, { kind: "user", text: "hey", at: 3 }, { kind: "assistant", text: "QUIET", at: 4 });
    copilot("review");
    expect(h.dropped).toEqual([]);
    vi.useFakeTimers();
    try {
      h.thread = [];
      run.watchForQuiet(0, 10);
      vi.advanceTimersByTime(20);
      h.thread.push({ kind: "user", text: "☀️ Morning check-in", at: 2 }, { kind: "assistant", text: "QUIET", at: 4 });
      copilot("review");
      expect(h.dropped).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("startCheckIns", () => {
  it("starts one clock, which ticks only while check-ins are on and logs a failed tick", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      run.setCheckInsOn(false, file);
      run.startCheckIns(() => true, file);
      run.startCheckIns(() => true, file);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(run.readState(file).day).toBe("");
      run.setCheckInsOn(true, file);
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(run.readState(file).day).not.toBe("");
      fs.rmSync(dir, { recursive: true, force: true });
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(error).toHaveBeenCalledWith("[weft] copilot check-in failed:", expect.any(Error));
    } finally {
      error.mockRestore();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
