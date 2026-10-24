import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { landWorktree, overwrittenFiles } from "./worktree-land";
import { cardWorktreePath, createWorktree, removeWorktree } from "./worktrees";
import type { CardWorktree } from "./types";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-land-")));
process.env.WEFT_DATA = path.join(tmp, "data");
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
const write = (dir: string, file: string, text: string) => fs.writeFileSync(path.join(dir, file), text);
const commitIn = (dir: string, file: string, text: string) => {
  write(dir, file, text);
  git(dir, "add", file);
  git(dir, "commit", "-qm", file);
};

let repo: string;
let wt: CardWorktree;
let n = 0;

beforeEach(async () => {
  repo = path.join(tmp, `repo${++n}`);
  fs.mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "T");
  commitIn(repo, "a.ts", "a1\n");
  commitIn(repo, "shared.ts", "s1\n");
  const p = cardWorktreePath(repo, `card${n}`);
  await createWorktree(repo, p);
  git(p, "checkout", "-q", "-b", `weft/c-${n}`);
  wt = { path: p, branch: `weft/c-${n}`, base: git(repo, "rev-parse", "HEAD"), repo };
});

describe("overwrittenFiles", () => {
  it("reads the files git refused to overwrite", () => {
    const err = "error: Your local changes to the following files would be overwritten by merge:\n\ta.ts\n\tb/c.ts\nPlease commit your changes or stash them before you merge.\nAborting";
    expect(overwrittenFiles(err)).toEqual(["a.ts", "b/c.ts"]);
    expect(overwrittenFiles("fatal: something else")).toEqual([]);
  });
});

describe("landWorktree", () => {
  it("commits what's left, fast-forwards the main tree and leaves other cards' uncommitted work alone", async () => {
    commitIn(wt.path, "b.ts", "b1\n");
    write(wt.path, "c.ts", "c1\n");
    write(repo, "shared.ts", "someone else's edit\n");
    write(repo, "untracked.ts", "theirs\n");
    const r = await landWorktree(wt, "Card title", { push: false });
    expect(r).toMatchObject({ ok: true, onto: "main", pushed: false });
    expect(fs.readFileSync(path.join(repo, "b.ts"), "utf8")).toBe("b1\n");
    expect(fs.readFileSync(path.join(repo, "c.ts"), "utf8")).toBe("c1\n");
    expect(git(repo, "log", "-1", "--format=%s")).toBe("Card title");
    expect(fs.readFileSync(path.join(repo, "shared.ts"), "utf8")).toBe("someone else's edit\n");
    expect(fs.readFileSync(path.join(repo, "untracked.ts"), "utf8")).toBe("theirs\n");
  });

  it("rebases on commits that landed meanwhile", async () => {
    commitIn(wt.path, "b.ts", "b1\n");
    commitIn(repo, "other.ts", "o\n");
    const r = await landWorktree(wt, "t", { push: false });
    expect(r.ok).toBe(true);
    expect(git(repo, "log", "--format=%s", "-3")).toBe("b.ts\nother.ts\nshared.ts");
  });

  it("says so when there's nothing to land", async () => {
    expect(await landWorktree(wt, "t", { push: false })).toMatchObject({ ok: true, nothing: true });
  });

  it("hands a conflict back with its files, the rebase aborted and main untouched", async () => {
    commitIn(wt.path, "a.ts", "mine\n");
    commitIn(repo, "a.ts", "theirs\n");
    const head = git(repo, "rev-parse", "HEAD");
    const r = await landWorktree(wt, "t", { push: false });
    expect(r).toMatchObject({ ok: false, kind: "conflict", files: ["a.ts"], onto: "main" });
    expect(git(repo, "rev-parse", "HEAD")).toBe(head);
    expect(git(wt.path, "status", "--porcelain")).toBe("");
  });

  it("refuses, touching nothing, when the main tree has uncommitted changes to a file the branch changes", async () => {
    commitIn(wt.path, "shared.ts", "mine\n");
    write(repo, "shared.ts", "uncommitted, another card's\n");
    const r = await landWorktree(wt, "t", { push: false });
    expect(r).toMatchObject({ ok: false, kind: "dirty", files: ["shared.ts"] });
    expect(fs.readFileSync(path.join(repo, "shared.ts"), "utf8")).toBe("uncommitted, another card's\n");
  });

  it("won't land on a detached main tree", async () => {
    commitIn(wt.path, "b.ts", "b\n");
    git(repo, "checkout", "-q", "--detach");
    expect(await landWorktree(wt, "t", { push: false })).toMatchObject({ ok: false, kind: "detached" });
  });

  it("reports a failed leftover commit", async () => {
    write(wt.path, "c.ts", "c\n");
    fs.mkdirSync(path.join(repo, ".git", "hooks"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho nope >&2\nexit 1\n", { mode: 0o755 });
    expect(await landWorktree(wt, "t", { push: false })).toMatchObject({ ok: false, kind: "commit", files: ["c.ts"] });
  });

  it("pushes when the branch has an upstream, and says it didn't when it has none", async () => {
    const remote = path.join(tmp, `remote${n}.git`);
    execFileSync("git", ["init", "-q", "--bare", remote]);
    git(repo, "remote", "add", "origin", remote);
    git(repo, "push", "-q", "-u", "origin", "main");
    commitIn(wt.path, "b.ts", "b\n");
    expect(await landWorktree(wt, "t")).toMatchObject({ ok: true, pushed: true });
    expect(git(remote, "log", "-1", "--format=%s", "main")).toBe("b.ts");
    git(repo, "branch", "--unset-upstream");
    commitIn(wt.path, "d.ts", "d\n");
    expect(await landWorktree(wt, "t")).toMatchObject({ ok: true, pushed: false });
    await removeWorktree(repo, wt.path, wt.branch, { force: true });
  });
});
