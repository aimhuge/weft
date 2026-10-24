import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-pool-")));
process.env.WEFT_DATA = path.join(tmp, "data");
const size = vi.hoisted(() => ({ n: 1 }));
vi.mock("./settings", () => ({ worktreePoolSize: () => size.n }));
vi.mock("./env", () => ({ cliEnv: () => ({ ...process.env }) }));

const { dropWorktree, fillPool, freshenPools, noteRepo, readyEntries, recentRepos, returnWorktree, startWorktreePool, takeWorktree, warmPool } = await import("./worktree-pool");
const { listWorktrees, repoDir, worktreesRoot } = await import("./worktrees");

const repo = path.join(tmp, "repo");
fs.mkdirSync(path.join(repo, "web"), { recursive: true });
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
git(repo, "init", "-q", "-b", "main");
git(repo, "config", "user.email", "t@example.com");
git(repo, "config", "user.name", "T");
fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules\n");
fs.writeFileSync(path.join(repo, "web", "a.ts"), "1\n");
fs.mkdirSync(path.join(repo, "node_modules", "dep"), { recursive: true });
fs.writeFileSync(path.join(repo, "node_modules", "dep", "index.js"), "module.exports = 1\n");
git(repo, "add", ".");
git(repo, "commit", "-qm", "init");
const commit = (file: string) => {
  fs.writeFileSync(path.join(repo, file), file);
  git(repo, "add", file);
  git(repo, "commit", "-qm", file);
};

beforeEach(() => {
  size.n = 1;
});

describe("recent repos", () => {
  it("remembers repos newest first and forgets them after a week", () => {
    noteRepo("/a", 1_000);
    noteRepo("/b", 2_000);
    noteRepo("/a", 3_000);
    expect(recentRepos(4_000)).toEqual(["/a", "/b"]);
    expect(recentRepos(3_000 + 8 * 86_400_000)).toEqual([]);
    fs.rmSync(path.join(worktreesRoot(), "repos.json"));
    expect(recentRepos()).toEqual([]);
  });
});

describe("the pool", () => {
  it("fills to the setting with node_modules cloned in, and does nothing at 0", async () => {
    size.n = 0;
    await fillPool(repo);
    expect(readyEntries(repo)).toEqual([]);
    size.n = 1;
    const a = fillPool(repo);
    expect(fillPool(repo)).toBe(a);
    await a;
    const [entry] = readyEntries(repo);
    expect(entry?.ready.base).toBe(git(repo, "rev-parse", "HEAD"));
    expect(fs.existsSync(path.join(entry!.path, "node_modules", "dep", "index.js"))).toBe(true);
    expect(git(entry!.path, "status", "--porcelain")).toBe("");
  });

  it("hands a card the ready entry at HEAD on its own branch, in its subfolder, and refills", async () => {
    commit("moved.ts");
    const pooled = readyEntries(repo)[0]!.path;
    const wt = await takeWorktree({ id: "card1234-x", title: "Fix login", cwd: path.join(repo, "web") });
    expect(wt).toMatchObject({ path: path.join(repoDir(repo), "card1234"), branch: "weft/fix-login-card12", repo, sub: "web" });
    expect(wt.base).toBe(git(repo, "rev-parse", "HEAD"));
    expect(git(wt.path, "rev-parse", "HEAD")).toBe(wt.base);
    expect(git(wt.path, "branch", "--show-current")).toBe(wt.branch);
    expect(fs.existsSync(pooled)).toBe(false);
    expect(fs.existsSync(path.join(wt.path, "node_modules", "dep"))).toBe(true);
    expect(recentRepos()).toContain(repo);
    await fillPool(repo);
    expect(readyEntries(repo)).toHaveLength(1);
  });

  it("reuses a worktree already in place for the card", async () => {
    const wt = await takeWorktree({ id: "card1234-x", title: "Fix login", cwd: repo });
    expect(wt.path).toBe(path.join(repoDir(repo), "card1234"));
    expect(wt.sub).toBeUndefined();
    await returnWorktree(wt);
  });

  it("makes one on the spot when none is ready", async () => {
    size.n = 0;
    const wt = await takeWorktree({ id: "slow0000", title: "Slow", cwd: repo });
    expect(fs.existsSync(path.join(wt.path, "node_modules", "dep"))).toBe(true);
    await dropWorktree(wt);
    expect(fs.existsSync(wt.path)).toBe(false);
  });

  it("refuses a folder outside git", async () => {
    await expect(takeWorktree({ id: "x", title: "x", cwd: tmp })).rejects.toThrow(/isn't in a git repo/);
  });

  it("freshens idle entries to HEAD on the tick", async () => {
    await fillPool(repo);
    commit("later.ts");
    noteRepo(repo);
    await freshenPools();
    const [entry] = readyEntries(repo);
    expect(git(entry!.path, "rev-parse", "HEAD")).toBe(git(repo, "rev-parse", "HEAD"));
    expect(entry!.ready.base).toBe(git(repo, "rev-parse", "HEAD"));
  });

  it("throws away a dirty idle entry instead of freshening it", async () => {
    const [entry] = readyEntries(repo);
    fs.writeFileSync(path.join(entry!.path, "stray.ts"), "x");
    commit("again.ts");
    await fillPool(repo);
    await freshenPools();
    expect(fs.existsSync(entry!.path)).toBe(false);
  });

  it("does nothing on the tick with the pool off", async () => {
    size.n = 0;
    await expect(freshenPools()).resolves.toBeUndefined();
  });

  it("returns a landed worktree to the pool, or removes it when the pool is full", async () => {
    await fillPool(repo);
    size.n = 2;
    const wt = await takeWorktree({ id: "ret00000", title: "Return", cwd: repo });
    await fillPool(repo);
    size.n = 3;
    await returnWorktree(wt);
    expect(readyEntries(repo)).toHaveLength(3);
    expect(git(repo, "branch", "--list", wt.branch)).toBe("");
    size.n = 1;
    const wt2 = await takeWorktree({ id: "ret11111", title: "Full", cwd: repo });
    await returnWorktree(wt2);
    expect(fs.existsSync(wt2.path)).toBe(false);
  });

  it("clears a fill a restart cut off", async () => {
    const stray = path.join(repoDir(repo), "pool-deadbeef");
    git(repo, "worktree", "add", "--detach", "-q", stray);
    for (const e of readyEntries(repo)) fs.rmSync(`${e.path}.ready.json`);
    await fillPool(repo);
    expect((await listWorktrees(repo)).some((w) => w.path === stray)).toBe(false);
  });

  it("warms the pool for a folder the dialog has open, and ignores one outside git", async () => {
    await warmPool(tmp);
    await warmPool(repo);
    await fillPool(repo);
    expect(readyEntries(repo).length).toBeGreaterThan(0);
  });
});

describe("startWorktreePool", () => {
  it("starts one timer per server", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, "setInterval");
    startWorktreePool(1000);
    startWorktreePool(1000);
    expect(spy).toHaveBeenCalledTimes(1);
    size.n = 0;
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
  });
});
