import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "./types";

// HOME is a fresh temp dir (repos.ts reads it at import), git repos are hand-made .git folders, and
// the gh CLI is a mocked execFile, so nothing touches real repos or the network.
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-repos-")));
process.env.HOME = home;

const projects = vi.hoisted(() => ({ list: [] as Project[] }));
vi.mock("./settings", () => ({ listProjects: vi.fn(() => projects.list) }));

type Callback = (err: unknown, out?: { stdout: string }) => void;
const execFile = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile }));
const runClone = vi.hoisted(() => vi.fn<(fullName: string, target: string) => Promise<void>>(() => Promise.resolve()));
vi.mock("./clone-progress", () => ({ runClone }));

const { cloneRepo, githubRepos, githubSlug, localRepos, projectRoot } = await import("./repos");
const { listProjects } = await import("./settings");

const g = globalThis as unknown as { __weftRepos?: unknown; __weftGithub?: unknown; __weftRoots: Map<string, string> };

afterAll(() => fs.rmSync(home, { recursive: true, force: true }));
beforeEach(() => {
  for (const entry of fs.readdirSync(home)) fs.rmSync(path.join(home, entry), { recursive: true, force: true });
  g.__weftRepos = undefined;
  g.__weftGithub = undefined;
  g.__weftRoots.clear();
  projects.list = [];
  execFile.mockReset();
  runClone.mockClear();
  vi.mocked(listProjects).mockClear();
});

const at = (...parts: string[]) => path.join(home, ...parts);

// A folder with a .git directory: HEAD on a branch (or a raw sha), an origin url, and fixed mtimes.
function repo(folder: string, { head = "ref: refs/heads/main", origin, mtime }: { head?: string; origin?: string; mtime?: number } = {}) {
  const git = path.join(folder, ".git");
  fs.mkdirSync(git, { recursive: true });
  fs.writeFileSync(path.join(git, "HEAD"), `${head}\n`);
  if (origin) fs.writeFileSync(path.join(git, "config"), `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${origin}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`);
  if (mtime) fs.utimesSync(path.join(git, "HEAD"), mtime / 1000, mtime / 1000);
  return folder;
}

// A linked worktree: its .git is a file pointing into the main repo's .git/worktrees/<name>.
function worktree(main: string, folder: string, name = path.basename(folder)) {
  const dir = path.join(main, ".git", "worktrees", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "commondir"), "../..\n");
  fs.writeFileSync(path.join(dir, "HEAD"), "ref: refs/heads/feature\n");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, ".git"), `gitdir: ${dir}\n`);
  return folder;
}

function ghReturns(stdout: string) {
  execFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Callback) => cb(null, { stdout }));
}
function ghFails(err: unknown) {
  execFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Callback) => cb(err));
}

describe("githubSlug", () => {
  it.each([
    ["git@github.com:me/app.git", "me/app"],
    ["https://github.com/me/app", "me/app"],
    ["https://github.com/me/app.git", "me/app"],
    ["https://github.com/me/app/", "me/app"],
    ["ssh://git@github.com/org/my.repo.git", "org/my.repo"],
    ["  https://github.com/me/app  ", "me/app"],
  ])("reads %s as %s", (url, slug) => {
    expect(githubSlug(url)).toBe(slug);
  });

  it.each(["https://gitlab.com/me/app", "https://github.com/me", "not a url"])("is undefined for %s", (url) => {
    expect(githubSlug(url)).toBeUndefined();
  });
});

describe("projectRoot", () => {
  it("is the folder itself for a plain repo or a folder without git", () => {
    expect(projectRoot(repo(at("dev", "app")))).toBe(at("dev", "app"));
    fs.mkdirSync(at("plain"));
    expect(projectRoot(at("plain"))).toBe(at("plain"));
  });

  it("is the main repo for a live worktree", () => {
    const main = repo(at("dev", "app"));
    expect(projectRoot(worktree(main, at("trees", "feature")))).toBe(main);
  });

  it("is the parent of a .claude/worktrees path once the worktree is gone", () => {
    expect(projectRoot(at("dev", "app", ".claude", "worktrees", "fervent-tu"))).toBe(at("dev", "app"));
    expect(projectRoot(at("dev", "app", ".claude", "worktrees", "x", "sub"))).toBe(at("dev", "app"));
  });

  it("is the folder itself when its .git file has no gitdir line", () => {
    fs.mkdirSync(at("odd"));
    fs.writeFileSync(at("odd", ".git"), "garbage\n");
    expect(projectRoot(at("odd"))).toBe(at("odd"));
  });

  it("is the folder itself when the commondir isn't a .git folder", () => {
    const dir = at("bare.git", "worktrees", "w");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "commondir"), "../..\n");
    fs.mkdirSync(at("w"));
    fs.writeFileSync(at("w", ".git"), `gitdir: ${dir}`);
    expect(projectRoot(at("w"))).toBe(at("w"));
  });

  it("caches the answer per folder", () => {
    const main = repo(at("dev", "app"));
    const tree = worktree(main, at("trees", "feature"));
    expect(projectRoot(tree)).toBe(main);
    fs.rmSync(path.join(tree, ".git"));
    expect(projectRoot(tree)).toBe(main);
  });
});

describe("localRepos", () => {
  it("finds nothing in an empty home", () => {
    expect(localRepos()).toEqual([]);
  });

  it("describes a repo in a code folder: branch, GitHub origin and last activity", () => {
    repo(at("dev", "app"), { origin: "git@github.com:me/app.git", mtime: 1_700_000_000_000 });
    expect(localRepos()).toEqual([
      { path: at("dev", "app"), name: "app", git: true, branch: "main", github: "me/app", activity: 1_700_000_000_000, recentAt: undefined },
    ]);
  });

  it("takes the latest of HEAD, index and FETCH_HEAD as the activity", () => {
    const folder = repo(at("code", "app"), { mtime: 1_000_000 });
    fs.writeFileSync(at("code", "app", ".git", "FETCH_HEAD"), "");
    fs.utimesSync(at("code", "app", ".git", "FETCH_HEAD"), 5_000, 5_000);
    expect(localRepos()[0]).toMatchObject({ path: folder, activity: 5_000_000 });
  });

  it("shows a detached HEAD as a short sha, and no branch for an empty HEAD", () => {
    repo(at("dev", "detached"), { head: "0123456789abcdef0123456789abcdef01234567" });
    repo(at("dev", "empty"), { head: "" });
    const byName = Object.fromEntries(localRepos().map((r) => [r.name, r]));
    expect(byName.detached!.branch).toBe("0123456");
    expect(byName.empty!.branch).toBeUndefined();
  });

  it("leaves github unset for a non-GitHub origin or no origin at all", () => {
    repo(at("dev", "lab"), { origin: "https://gitlab.com/me/lab.git" });
    repo(at("dev", "none"));
    fs.writeFileSync(at("dev", "none", ".git", "config"), "[remote \"upstream\"]\n\turl = git@github.com:x/y.git\n");
    expect(localRepos().map((r) => r.github)).toEqual([undefined, undefined]);
  });

  it("reads a worktree's origin from the main repo's config", () => {
    const main = repo(at("elsewhere", "app"), { origin: "https://github.com/me/app" });
    worktree(main, at("dev", "app-feature"));
    expect(localRepos()).toMatchObject([{ path: at("dev", "app-feature"), branch: "feature", github: "me/app" }]);
  });

  it("looks one level into folders of repos, but no deeper", () => {
    repo(at("dev", "my-org", "one"));
    fs.mkdirSync(at("dev", "my-org", "notes"));
    repo(at("dev", "a", "b", "too-deep"));
    expect(localRepos().map((r) => r.path)).toEqual([at("dev", "my-org", "one")]);
  });

  it("skips dot folders, build and dependency folders, and files", () => {
    for (const skip of [".cache", "node_modules", "dist", "build", "vendor", "target", "Library"]) repo(at("dev", skip));
    fs.mkdirSync(at("dev"), { recursive: true });
    fs.writeFileSync(at("dev", "file.txt"), "x");
    repo(at("Sites", "site"));
    expect(localRepos().map((r) => r.name)).toEqual(["site"]);
  });

  it("puts recent projects first, git or not, most recently used first, and drops ones that are gone", () => {
    const old = repo(at("dev", "old"), { mtime: 9_000_000 });
    const busy = repo(at("dev", "busy"), { mtime: 5_000_000 });
    const quiet = repo(at("dev", "org", "quiet"), { mtime: 1_000_000 });
    fs.mkdirSync(at("notes"));
    projects.list = [
      { path: quiet, lastUsedAt: 100 },
      { path: at("notes"), lastUsedAt: 200 },
      { path: at("gone"), lastUsedAt: 300 },
    ];
    const repos = localRepos();
    expect(repos.map((r) => r.path)).toEqual([at("notes"), quiet, old, busy]);
    expect(repos[0]).toEqual({ path: at("notes"), name: "notes", git: false, branch: undefined, github: undefined, activity: 0, recentAt: 200 });
    expect(repos[1]!.recentAt).toBe(100);
    expect(repos.filter((r) => r.path === quiet)).toHaveLength(1);
  });

  it("doesn't list a recent project twice when it's also a top-level repo", () => {
    const app = repo(at("dev", "app"));
    projects.list = [{ path: app, lastUsedAt: 1 }];
    expect(localRepos()).toHaveLength(1);
  });

  it("serves a scan from cache for 20 seconds unless asked for a fresh one", () => {
    repo(at("dev", "one"));
    const first = localRepos();
    repo(at("dev", "two"));
    expect(localRepos()).toBe(first);
    expect(localRepos({ fresh: true })).toHaveLength(2);
  });

  it("rescans once the cache is older than 20 seconds", () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ["Date"] });
    try {
      localRepos();
      repo(at("dev", "later"));
      vi.setSystemTime(1_000_000 + 19_999);
      expect(localRepos()).toEqual([]);
      vi.setSystemTime(1_000_000 + 20_000);
      expect(localRepos()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops after looking inside 1500 folders, so a huge code folder can't stall it", () => {
    for (let i = 0; i < 1600; i++) fs.mkdirSync(at("dev", "huge", `f${i}`), { recursive: true });
    repo(at("dev", "zz-after"));
    repo(at("code", "app"));
    expect(localRepos()).toEqual([]);
  });
});

describe("githubRepos", () => {
  const RAW = JSON.stringify([
    { full_name: "me/app", description: "An app", private: true, pushed_at: "2026-01-02T00:00:00Z" },
    { full_name: "Org/Lib", description: null, private: false, pushed_at: null },
  ]);

  it("asks gh for the user's repos and maps them", async () => {
    ghReturns(RAW);
    expect(await githubRepos()).toEqual([
      { fullName: "me/app", description: "An app", private: true, pushedAt: Date.parse("2026-01-02T00:00:00Z"), localPath: undefined },
      { fullName: "Org/Lib", description: undefined, private: false, pushedAt: 0, localPath: undefined },
    ]);
    expect(execFile).toHaveBeenCalledWith(
      "gh",
      ["api", "user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator,organization_member"],
      { timeout: 20_000, maxBuffer: 32 * 1024 * 1024 },
      expect.any(Function),
    );
  });

  it("marks the repos already cloned here, ignoring case, preferring the most active clone", async () => {
    repo(at("dev", "a-lib"), { origin: "git@github.com:org/lib.git", mtime: 2_000_000 });
    repo(at("dev", "b-lib"), { origin: "git@github.com:org/lib.git", mtime: 1_000_000 });
    ghReturns(RAW);
    const repos = await githubRepos();
    expect(repos.find((r) => r.fullName === "Org/Lib")?.localPath).toBe(at("dev", "a-lib"));
    expect(repos.find((r) => r.fullName === "me/app")?.localPath).toBeUndefined();
  });

  it("caches the list for two minutes but still refreshes which ones are cloned", async () => {
    ghReturns(RAW);
    await githubRepos();
    repo(at("dev", "app"), { origin: "https://github.com/me/app" });
    g.__weftRepos = undefined;
    const again = await githubRepos();
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(again[0]!.localPath).toBe(at("dev", "app"));
    await githubRepos({ fresh: true });
    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it("refetches once the cache is two minutes old", async () => {
    vi.useFakeTimers({ now: 5_000_000, toFake: ["Date"] });
    try {
      ghReturns(RAW);
      await githubRepos();
      vi.setSystemTime(5_000_000 + 119_999);
      await githubRepos();
      expect(execFile).toHaveBeenCalledTimes(1);
      vi.setSystemTime(5_000_000 + 120_000);
      await githubRepos();
      expect(execFile).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says to install gh when it's missing", async () => {
    ghFails(Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }));
    await expect(githubRepos()).rejects.toThrow("The GitHub CLI isn't installed. brew install gh, then gh auth login.");
  });

  it("says to log in when gh isn't authenticated", async () => {
    ghFails(Object.assign(new Error("exit 4"), { stderr: "To get started with GitHub CLI, please run:  gh auth login\n" }));
    await expect(githubRepos()).rejects.toThrow("The GitHub CLI isn't logged in. Run gh auth login.");
    ghFails(new Error("You are not logged into any GitHub hosts"));
    await expect(githubRepos({ fresh: true })).rejects.toThrow("The GitHub CLI isn't logged in. Run gh auth login.");
  });

  it("otherwise shows the last three lines of gh's error", async () => {
    ghFails(Object.assign(new Error("exit 1"), { stderr: "one\ntwo\nthree\nfour\n" }));
    await expect(githubRepos()).rejects.toThrow(/^two three four$/);
    ghFails("plain string");
    await expect(githubRepos()).rejects.toThrow(/^plain string$/);
  });

  it("fails when gh prints something that isn't JSON", async () => {
    ghReturns("<html>");
    await expect(githubRepos()).rejects.toThrow(/JSON/);
  });
});

describe("cloneRepo", () => {
  it("rejects anything that isn't owner/name", async () => {
    for (const bad of ["app", "a/b/c", "me/app;rm", " me/app", "me/"]) {
      await expect(cloneRepo(bad), bad).rejects.toThrow("Pick a repo like owner/name.");
    }
    expect(runClone).not.toHaveBeenCalled();
  });

  it("returns an existing clone without running gh, ignoring case", async () => {
    repo(at("dev", "app"), { origin: "https://github.com/Me/App.git" });
    expect(await cloneRepo("me/app")).toBe(at("dev", "app"));
    expect(runClone).not.toHaveBeenCalled();
  });

  it("scans fresh before looking for an existing clone", async () => {
    localRepos();
    repo(at("dev", "new"), { origin: "https://github.com/me/new" });
    expect(await cloneRepo("me/new")).toBe(at("dev", "new"));
  });

  it("clones into ~/dev, picking a free name, and drops the cached scan", async () => {
    fs.mkdirSync(at("dev", "app"), { recursive: true });
    fs.mkdirSync(at("dev", "app-2"));
    ghReturns("");
    localRepos();
    expect(await cloneRepo("me/app")).toBe(at("dev", "app-3"));
    expect(runClone).toHaveBeenCalledWith("me/app", at("dev", "app-3"));
    expect(g.__weftRepos).toBeUndefined();
  });

  it("clones into the home folder when there's no ~/dev", async () => {
    ghReturns("");
    expect(await cloneRepo("me/app")).toBe(at("app"));
  });

  it("explains a failed clone", async () => {
    runClone.mockRejectedValueOnce(new Error("GraphQL: Could not resolve to a Repository\n"));
    await expect(cloneRepo("me/missing")).rejects.toThrow("Couldn't clone me/missing: GraphQL: Could not resolve to a Repository");
  });
});
