import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { branchOf, commitsOf, createGitWatch, parseReflog, pushesOf } from "./slack-git";

// Commits and pushes for Slack, read from each repo's reflog. The pure parsers, and a watcher against a real
// throwaway git repo: a commit, a push, a branch's first push.

let dir: string;

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

// A repo with one commit on main.
function repo(): string {
  const cwd = fs.mkdtempSync(path.join(dir, "repo-"));
  git(cwd, "init", "-q", "-b", "main");
  git(cwd, "config", "user.email", "weft@example.com");
  git(cwd, "config", "user.name", "Weft");
  fs.writeFileSync(path.join(cwd, "a.txt"), "one\n");
  git(cwd, "add", "a.txt");
  git(cwd, "commit", "-q", "-m", "first");
  return cwd;
}

const commit = (cwd: string, message: string) => {
  fs.writeFileSync(path.join(cwd, "a.txt"), `${message}\n`);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", message);
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-slack-git-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("parseReflog", () => {
  it("reads old, new and message from a reflog line", () => {
    const line = "aaaaaaa bbbbbbb Weft <weft@example.com> 1700000000 +0100\tcommit: fix login";
    expect(parseReflog(line)).toEqual([{ old: "aaaaaaa", sha: "bbbbbbb", message: "commit: fix login" }]);
  });

  it("skips a line without a tab", () => {
    expect(parseReflog("aaaaaaa bbbbbbb Weft <weft@example.com> 1700000000 +0100")).toEqual([]);
  });

  it("skips a line without a sha", () => {
    expect(parseReflog("aaaaaaa  Weft <weft@example.com> 1700000000 +0100\tcommit: x")).toEqual([]);
  });

  it("is empty for no text at all", () => {
    expect(parseReflog("")).toEqual([]);
  });
});

describe("commitsOf", () => {
  const entry = (message: string) => ({ old: "a", sha: "b", message });

  it("keeps every kind of commit", () => {
    const messages = ["commit: fix", "commit (amend): fix", "commit (initial): first", "commit (merge): merge"];
    expect(commitsOf(messages.map(entry))).toEqual(messages.map((message) => ({ sha: "b", subject: message.slice(message.indexOf(": ") + 2) })));
  });

  it("drops a checkout, a reset and a rebase", () => {
    expect(commitsOf([entry("checkout: moving from main to feat"), entry("reset: moving to HEAD"), entry("rebase (finish): done")])).toEqual([]);
  });
});

describe("pushesOf", () => {
  it("keeps only the pushes", () => {
    const entries = [
      { old: "a", sha: "b", message: "update by push" },
      { old: "a", sha: "b", message: "fetch: origin/main" },
    ];
    expect(pushesOf(entries)).toEqual([entries[0]]);
  });
});

describe("branchOf", () => {
  it("reads the branch from HEAD", () => {
    const file = path.join(dir, "HEAD");
    fs.writeFileSync(file, "ref: refs/heads/main\n");
    expect(branchOf(file)).toBe("main");
  });

  it("says a detached HEAD has no branch", () => {
    const file = path.join(dir, "HEAD");
    fs.writeFileSync(file, "abcdef123456\n");
    expect(branchOf(file)).toBe("detached HEAD");
  });

  it("has no branch for a HEAD it can't read", () => {
    expect(branchOf(path.join(dir, "nope"))).toBe("HEAD");
  });
});

// Real git repos: each test makes one, so it gets more time than the default.
describe("createGitWatch", { timeout: 30_000 }, () => {
  it("records the first look without posting what came before it", async () => {
    const cwd = repo();
    const onCommits = vi.fn();
    const onPush = vi.fn();
    const watch = createGitWatch({ onCommits, onPush });
    await watch.tick([cwd]);
    expect(onCommits).not.toHaveBeenCalled();
    expect(onPush).not.toHaveBeenCalled();
  });

  it("posts a new commit with its branch and subject", async () => {
    const cwd = repo();
    const onCommits = vi.fn();
    const watch = createGitWatch({ onCommits, onPush: vi.fn() });
    await watch.tick([cwd]);
    commit(cwd, "fix login");
    await watch.tick([cwd]);
    expect(onCommits).toHaveBeenCalledTimes(1);
    const [gotCwd, branch, commits] = onCommits.mock.calls[0] as [string, string, { sha: string; subject: string }[]];
    expect(gotCwd).toBe(cwd);
    expect(branch).toBe("main");
    expect(commits).toHaveLength(1);
    expect(commits[0]?.subject).toBe("fix login");
  });

  it("skips a folder that isn't a repo", async () => {
    const plain = fs.mkdtempSync(path.join(dir, "plain-"));
    const onCommits = vi.fn();
    const watch = createGitWatch({ onCommits, onPush: vi.fn() });
    await watch.tick([plain]);
    expect(onCommits).not.toHaveBeenCalled();
  });

  it("reads a repo once when two folders are the same repo", async () => {
    const cwd = repo();
    const onCommits = vi.fn();
    const watch = createGitWatch({ onCommits, onPush: vi.fn() });
    await watch.tick([cwd, cwd]);
    commit(cwd, "fix login");
    await watch.tick([cwd, cwd]);
    expect(onCommits).toHaveBeenCalledTimes(1);
  });

  it("posts a push with its remote ref and how many commits it sent", async () => {
    const cwd = repo();
    const remote = fs.mkdtempSync(path.join(dir, "remote-"));
    git(remote, "init", "-q", "--bare");
    git(cwd, "remote", "add", "origin", remote);
    const onPush = vi.fn();
    const watch = createGitWatch({ onCommits: vi.fn(), onPush });
    await watch.tick([cwd]);
    commit(cwd, "fix login");
    git(cwd, "push", "-q", "origin", "main");
    await watch.tick([cwd]);
    expect(onPush).toHaveBeenCalledTimes(1);
    const [gotCwd, remoteRef, count] = onPush.mock.calls[0] as [string, string, number];
    expect(gotCwd).toBe(cwd);
    expect(remoteRef).toBe("origin/main");
    // The push carried the branch's whole history: the first commit and the one after it.
    expect(count).toBe(2);
  });

  it("reads a branch's first push from the start of its file", async () => {
    const cwd = repo();
    const remote = fs.mkdtempSync(path.join(dir, "remote-"));
    git(remote, "init", "-q", "--bare");
    git(cwd, "remote", "add", "origin", remote);
    const onPush = vi.fn();
    const watch = createGitWatch({ onCommits: vi.fn(), onPush });
    // The repo is looked at first, so the remote ref file that turns up later is a branch's first push.
    await watch.tick([cwd]);
    git(cwd, "push", "-q", "origin", "main");
    await watch.tick([cwd]);
    expect(onPush).toHaveBeenCalledTimes(1);
    const [gotCwd, remoteRef, count] = onPush.mock.calls[0] as [string, string, number];
    expect(gotCwd).toBe(cwd);
    expect(remoteRef).toBe("origin/main");
    expect(count).toBe(1);
  });

  it("counts one commit for a push whose commits it can't count", async () => {
    const cwd = repo();
    const remote = fs.mkdtempSync(path.join(dir, "remote-"));
    git(remote, "init", "-q", "--bare");
    git(cwd, "remote", "add", "origin", remote);
    const onPush = vi.fn();
    const watch = createGitWatch({ onCommits: vi.fn(), onPush });
    await watch.tick([cwd]);
    git(cwd, "push", "-q", "origin", "main");
    // The remote ref's reflog says the branch moved from a commit this repo no longer has.
    const refLog = path.join(cwd, ".git", "logs", "refs", "remotes", "origin", "main");
    const sha = git(cwd, "rev-parse", "HEAD").trim();
    fs.writeFileSync(refLog, `0123456789abcdef0123456789abcdef01234567 ${sha} Weft <weft@example.com> 1700000000 +0100\tupdate by push\n`);
    await watch.tick([cwd]);
    expect(onPush).toHaveBeenCalledTimes(1);
    expect(onPush.mock.calls[0]?.[2]).toBe(1);
  });

  it("counts one commit for a push that moved no commits", async () => {
    const cwd = repo();
    const remote = fs.mkdtempSync(path.join(dir, "remote-"));
    git(remote, "init", "-q", "--bare");
    git(cwd, "remote", "add", "origin", remote);
    const onPush = vi.fn();
    const watch = createGitWatch({ onCommits: vi.fn(), onPush });
    await watch.tick([cwd]);
    git(cwd, "push", "-q", "origin", "main");
    // The branch moved to the commit it was already on, so there is nothing in between.
    const refLog = path.join(cwd, ".git", "logs", "refs", "remotes", "origin", "main");
    const sha = git(cwd, "rev-parse", "HEAD").trim();
    fs.writeFileSync(refLog, `${sha} ${sha} Weft <weft@example.com> 1700000000 +0100\tupdate by push\n`);
    await watch.tick([cwd]);
    expect(onPush).toHaveBeenCalledTimes(1);
    expect(onPush.mock.calls[0]?.[2]).toBe(1);
  });

  it("skips a remote ref it can't read", async () => {
    const cwd = repo();
    const onPush = vi.fn();
    const watch = createGitWatch({ onCommits: vi.fn(), onPush });
    await watch.tick([cwd]);
    // A remote ref that points nowhere: it is listed, but there is nothing to read.
    const remotes = path.join(cwd, ".git", "logs", "refs", "remotes", "origin");
    fs.mkdirSync(remotes, { recursive: true });
    fs.symlinkSync(path.join(dir, "gone"), path.join(remotes, "main"));
    await watch.tick([cwd]);
    expect(onPush).not.toHaveBeenCalled();
  });
});
