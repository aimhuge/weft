import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { branchFor, cardSlug, cardWorktreePath, createWorktree, dirtyIn, headOf, isOurs, listBranches, listWorktrees, moveWorktree, parseBranches, parseWorktreeList, removeWorktree, repoDir, repoKey, repoRootOf, worktreeAt, worktreesRoot } from "./worktrees";
import { awaitingWorktree, workDir } from "./work-dir";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-wt-")));
process.env.WEFT_DATA = path.join(tmp, "data");
const repo = path.join(tmp, "repo");
fs.mkdirSync(path.join(repo, "packages", "web"), { recursive: true });
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
git(repo, "init", "-q", "-b", "main");
git(repo, "config", "user.email", "t@example.com");
git(repo, "config", "user.name", "T");
fs.writeFileSync(path.join(repo, "a.ts"), "1\n");
fs.writeFileSync(path.join(repo, "packages", "web", "b.ts"), "1\n");
git(repo, "add", ".");
git(repo, "commit", "-qm", "init");

describe("names", () => {
  it("keeps worktrees under WEFT_DATA, per repo name plus a hash of its path", () => {
    expect(worktreesRoot()).toBe(path.join(tmp, "data", "worktrees"));
    expect(repoKey("/Users/me/dev/weft")).toMatch(/^weft-[0-9a-f]{6}$/);
    expect(repoKey("/a/app")).not.toBe(repoKey("/b/app"));
    expect(repoKey("/x/My App!")).toMatch(/^my-app-[0-9a-f]{6}$/);
    expect(repoKey("/")).toMatch(/^repo-/);
    expect(repoDir(repo)).toBe(path.join(worktreesRoot(), repoKey(repo)));
  });

  it("slugs a title to at most 40 characters, on a word boundary when it can", () => {
    expect(cardSlug("Fix the login page!")).toBe("fix-the-login-page");
    expect(cardSlug("Café — déjà vu")).toBe("cafe-deja-vu");
    const long = cardSlug("Build opt-in worktree isolation for Weft cards so they stop colliding");
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith("-")).toBe(false);
    expect(cardSlug("x".repeat(60))).toHaveLength(40);
  });

  it("names the branch weft/<slug>-<id6> and the folder by the id", () => {
    expect(branchFor({ id: "abc12345-6789", title: "Fix login" })).toBe("weft/fix-login-abc123");
    expect(branchFor({ id: "abc12345", title: "!!!" })).toBe("weft/card-abc123");
    expect(cardWorktreePath(repo, "abc12345-6789-0000")).toBe(path.join(repoDir(repo), "abc12345"));
  });
});

describe("workDir", () => {
  it("is cwd for a shared card and the worktree (plus its subfolder) for an isolated one", () => {
    expect(workDir({ cwd: "/p" })).toBe("/p");
    expect(workDir({ cwd: "/p", worktree: { path: "/w", branch: "b", base: "c", repo: "/p" } })).toBe("/w");
    expect(workDir({ cwd: "/p/web", worktree: { path: "/w", branch: "b", base: "c", repo: "/p", sub: "web" } })).toBe("/w/web");
  });

  it("knows a card still waiting on its worktree", () => {
    expect(awaitingWorktree({ isolated: true })).toBe(true);
    expect(awaitingWorktree({ isolated: true, worktree: { path: "/w", branch: "b", base: "c", repo: "/p" } })).toBe(false);
    expect(awaitingWorktree({})).toBe(false);
  });
});

describe("parseWorktreeList", () => {
  it("reads porcelain blocks, branch or detached", () => {
    const out = "worktree /r\nHEAD aaa\nbranch refs/heads/main\n\nworktree /w\nHEAD bbb\ndetached\n\n";
    expect(parseWorktreeList(out)).toEqual([
      { path: "/r", head: "aaa", branch: "main" },
      { path: "/w", head: "bbb" },
    ]);
    expect(parseWorktreeList("garbage")).toEqual([]);
  });
});

describe("parseBranches", () => {
  it("reads name, worktree and date, skipping blank lines", () => {
    expect(parseBranches("main\t/r\t20\nfeat/x\t\t10\n\n")).toEqual([
      { name: "main", at: 20, worktree: "/r" },
      { name: "feat/x", at: 10 },
    ]);
    expect(parseBranches("odd")).toEqual([{ name: "odd", at: 0 }]);
  });
});

describe("worktrees in a real repo", () => {
  const a = path.join(repoDir(repo), "aaaa1111");
  const b = path.join(repoDir(repo), "bbbb2222");

  it("finds the repo root, and nothing outside git", async () => {
    expect(await repoRootOf(path.join(repo, "packages", "web"))).toBe(repo);
    expect(await repoRootOf(tmp)).toBeUndefined();
  });

  it("only treats direct children of the repo's worktree folder as its own", () => {
    expect(isOurs(repo, a)).toBe(true);
    expect(isOurs(repo, repoDir(repo))).toBe(false);
    expect(isOurs(repo, path.join(a, "deeper"))).toBe(false);
    expect(isOurs(repo, repo)).toBe(false);
  });

  it("creates, lists, moves and removes, leaving the main tree alone", async () => {
    await createWorktree(repo, a);
    expect(git(a, "rev-parse", "HEAD")).toBe(await headOf(repo));
    expect((await listWorktrees(repo)).map((w) => w.path)).toEqual([a]);
    await moveWorktree(repo, a, b);
    expect(fs.existsSync(a)).toBe(false);
    git(b, "checkout", "-q", "-b", "weft/x-1");
    expect((await listWorktrees(repo))[0]).toMatchObject({ path: b, branch: "weft/x-1" });
    fs.writeFileSync(path.join(b, "new.ts"), "x\n");
    expect(await dirtyIn(b)).toEqual(["new.ts"]);
    expect(await dirtyIn(repo)).toEqual([]);
    await removeWorktree(repo, b, "weft/x-1");
    expect(fs.existsSync(b)).toBe(false);
    expect(await listWorktrees(repo)).toEqual([]);
    expect(git(repo, "branch", "--list", "weft/x-1")).toBe("");
  });

  it("keeps an unlanded branch unless forced", async () => {
    await createWorktree(repo, a);
    git(a, "checkout", "-q", "-b", "weft/keep-1");
    fs.writeFileSync(path.join(a, "c.ts"), "c\n");
    git(a, "add", ".");
    git(a, "commit", "-qm", "c");
    await removeWorktree(repo, a, "weft/keep-1");
    expect(git(repo, "branch", "--list", "weft/keep-1")).toContain("weft/keep-1");
    await createWorktree(repo, a, "weft/keep-1");
    await removeWorktree(repo, a, "weft/keep-1", { force: true });
    expect(git(repo, "branch", "--list", "weft/keep-1")).toBe("");
  });

  it("lists the repo's branches and where each is checked out", async () => {
    git(repo, "branch", "side");
    const branches = await listBranches(repo);
    expect(branches.find((b) => b.name === "main")?.worktree).toBe(repo);
    expect(branches.find((b) => b.name === "side")).toMatchObject({ name: "side" });
    expect(branches.find((b) => b.name === "side")?.worktree).toBeUndefined();
  });

  it("refuses paths that aren't its own", async () => {
    await expect(createWorktree(repo, path.join(tmp, "elsewhere"))).rejects.toThrow(/isn't one of Weft's worktrees/);
    await expect(removeWorktree(repo, repo)).rejects.toThrow(/isn't one of Weft's worktrees/);
    await expect(moveWorktree(repo, a, repo)).rejects.toThrow();
  });

  it("removes a folder git no longer knows", async () => {
    fs.mkdirSync(a, { recursive: true });
    await removeWorktree(repo, a);
    expect(fs.existsSync(a)).toBe(false);
  });

  it("says undefined when git can't read a tree", async () => {
    expect(await dirtyIn(path.join(tmp, "nope"))).toBeUndefined();
  });
});

describe("worktreeAt", () => {
  it("finds the worktree a folder is in, and nothing above or outside one", () => {
    const root = "/d/worktrees";
    expect(worktreeAt("/d/worktrees/weft-1/abc/src/x", root)).toBe("/d/worktrees/weft-1/abc");
    expect(worktreeAt("/d/worktrees/weft-1/abc", root)).toBe("/d/worktrees/weft-1/abc");
    expect(worktreeAt("/d/worktrees/weft-1", root)).toBeUndefined();
    expect(worktreeAt("/d/worktrees", root)).toBeUndefined();
    expect(worktreeAt("/elsewhere", root)).toBeUndefined();
    expect(worktreeAt(path.join(worktreesRoot(), "r", "n"))).toBe(path.join(worktreesRoot(), "r", "n"));
  });
});
