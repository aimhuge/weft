import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commitFiles, commitsSince, head, resolveCommit } from "./changelog-git";

// The changelog's git reads (lib/changelog-git.ts) against a real temp repo.

const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-changelog-git-")));
const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
git("init", "-q");
git("config", "user.email", "t@t");
git("config", "user.name", "t");
const commit = (...names: string[]) => {
  for (const name of names) {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), name);
  }
  git("add", ...names);
  git("commit", "-qm", names.join(" "));
  return git("rev-parse", "HEAD");
};

describe("changelog git", () => {
  it("answers null or empty outside a repo and before the first commit", () => {
    expect(head(repo)).toBeNull();
    expect(resolveCommit(repo, "HEAD")).toBeNull();
    expect(commitFiles(os.tmpdir(), "HEAD")).toEqual([]);
  });

  it("reads HEAD, a commit's files (the root commit too), and resolves short shas", () => {
    const first = commit("a.ts", "lib/b.ts");
    expect(head(repo)).toBe(first);
    expect(commitFiles(repo, first).sort()).toEqual(["a.ts", "lib/b.ts"]);
    expect(resolveCommit(repo, first.slice(0, 7))).toBe(first);
    expect(resolveCommit(repo, "nope")).toBeNull();
  });

  it("lists the commits a call landed, oldest first", () => {
    const from = git("rev-parse", "HEAD");
    const c1 = commit("c.ts");
    const c2 = commit("d.ts");
    expect(commitsSince(repo, from, c2)).toEqual([c1, c2]);
    expect(commitsSince(repo, "", c2)).toEqual([c2]);
    // HEAD moved back (a reset): just the new HEAD; and git failing falls back to it too.
    expect(commitsSince(repo, c2, c1)).toEqual([c1]);
    expect(commitsSince(repo, "bogus", c2)).toEqual([c2]);
  });
});
