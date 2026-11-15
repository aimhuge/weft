import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultGit, type Git } from "./handover-push";
import { follower, parseRaw } from "./tree-sync-follow";

const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", env }).trim();

let tmp: string;
// `mac` makes the commits; `box` is the checkout that follows.
let mac: string;
let box: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "weft-follow-"));
  const origin = path.join(tmp, "origin.git");
  git(tmp, "init", "-q", "--bare", "-b", "main", origin);
  mac = path.join(tmp, "mac");
  git(tmp, "clone", "-q", origin, mac);
  for (const f of ["a.ts", "b.ts", "gone.ts", "keep.ts"]) writeFileSync(path.join(mac, f), `${f}\n`);
  writeFileSync(path.join(mac, ".gitignore"), "dist/\n");
  git(mac, "add", "-A");
  git(mac, "commit", "-q", "-m", "init");
  git(mac, "push", "-q", "origin", "main");
  box = path.join(tmp, "box");
  git(tmp, "clone", "-q", origin, box);
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const put = (root: string, p: string, text: string) => {
  mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
  writeFileSync(path.join(root, p), text);
};
const at = (root: string, p: string) => (existsSync(path.join(root, p)) ? readFileSync(path.join(root, p), "utf8") : null);
const where = (root: string) => ({ branch: git(root, "symbolic-ref", "--short", "HEAD"), head: git(root, "rev-parse", "HEAD") });

// The Mac's next commit: a.ts edited, new.ts added, gone.ts removed.
function commit(push = true) {
  put(mac, "a.ts", "a, edited\n");
  put(mac, "new.ts", "new\n");
  rmSync(path.join(mac, "gone.ts"));
  git(mac, "add", "-A");
  git(mac, "commit", "-q", "-m", "next");
  if (push) git(mac, "push", "-q", "origin", "main");
  return git(mac, "rev-parse", "HEAD");
}

describe("catching a synced folder up to the other end's commit", { timeout: 30_000 }, () => {
  it("fast-forwards a checkout that is behind, fetching the commit first", async () => {
    const want = commit();
    expect(await follower(box, "your Mac")(where(box), want)).toEqual({ moved: true });
    expect(where(box).head).toBe(want);
    expect(at(box, "a.ts")).toBe("a, edited\n");
    expect(at(box, "gone.ts")).toBeNull();
    expect(git(box, "status", "--porcelain")).toBe("");
  });

  it("keeps uncommitted work, and isn't stopped by files that already hold the commit's version", async () => {
    // The commit's own changes synced over before it was made, an ignored file among them; b.ts is the box's own work.
    put(mac, "dist/out.js", "built\n");
    git(mac, "add", "-f", "dist/out.js");
    const want = commit();
    put(box, "a.ts", "a, edited\n");
    put(box, "new.ts", "new\n");
    put(box, "dist/out.js", "built\n");
    rmSync(path.join(box, "gone.ts"));
    put(box, "b.ts", "the box's own edit\n");
    expect(await follower(box, "your Mac")(where(box), want)).toEqual({ moved: true });
    expect(where(box).head).toBe(want);
    expect(git(box, "status", "--porcelain")).toBe("M b.ts");
    expect(at(box, "b.ts")).toBe("the box's own edit\n");
  });

  it("waits for a commit that isn't pushed yet, asking the remote at most every 20 seconds", async () => {
    const want = commit(false);
    let now = 1_000_000;
    const fetches: string[][] = [];
    const counting: Git = (cwd, args, e) => {
      if (args.includes("fetch")) fetches.push(args);
      return defaultGit(cwd, args, e);
    };
    const follow = follower(box, "your Mac", { git: counting, now: () => now });
    expect(await follow(where(box), want)).toEqual({ moved: false, why: "missing", reason: `Waiting for commit ${want.slice(0, 7)} to be pushed` });
    git(mac, "push", "-q", "origin", "main");
    now += 5_000;
    expect(await follow(where(box), want)).toMatchObject({ why: "missing" });
    // One fetch so far: this branch from origin, the repo's hooks off.
    expect(fetches).toHaveLength(1);
    expect(fetches[0]?.slice(-5)).toEqual(["fetch", "--quiet", "--no-tags", "origin", "main"]);
    expect(fetches[0]).toContain("core.hooksPath=/dev/null");
    now += 20_000;
    expect(await follow(where(box), want)).toEqual({ moved: true });
  });

  it("asks less and less often for a commit that never comes, and at once for a new one", async () => {
    const want = commit(false);
    let now = 1_000_000;
    let fetches = 0;
    const counting: Git = (cwd, args, e) => {
      if (args.includes("fetch")) fetches++;
      return defaultGit(cwd, args, e);
    };
    const follow = follower(box, "your Mac", { git: counting, now: () => now });
    const tries = async (after: number) => {
      now += after;
      await follow(where(box), want);
      return fetches;
    };
    expect(await tries(0)).toBe(1);
    expect(await tries(20_000)).toBe(2);
    // The wait doubled: 20 s more isn't enough, 40 s is.
    expect(await tries(20_000)).toBe(2);
    expect(await tries(20_000)).toBe(3);
    for (let i = 0; i < 6; i++) await tries(10 * 60_000);
    expect(await tries(299_000)).toBe(9);
    expect(await tries(1_000)).toBe(10);
    // Another commit is asked about at once, but not within 20 s of the last fetch, however many names arrive.
    await follow(where(box), "f".repeat(40));
    await follow(where(box), "e".repeat(40));
    expect(fetches).toBe(10);
    now += 20_000;
    await follow(where(box), "d".repeat(40));
    expect(fetches).toBe(11);
  });

  it("leaves the end that is ahead where it is", async () => {
    const old = where(mac).head;
    commit();
    const r = await follower(mac, "m1mini")(where(mac), old);
    expect(r).toEqual({ moved: false, why: "ahead", reason: `Waiting for m1mini to catch up to ${where(mac).head.slice(0, 7)}` });
  });

  it("won't pick a side when each end has commits the other lacks", async () => {
    const want = commit();
    put(box, "b.ts", "committed on the box\n");
    git(box, "commit", "-qam", "the box's own");
    const before = where(box);
    expect(await follower(box, "your Mac")(before, want)).toMatchObject({ moved: false, why: "diverged" });
    expect(where(box)).toEqual(before);
  });

  it("moves nothing when a file changed here is changed by the commit to something else", async () => {
    const want = commit();
    put(box, "a.ts", "the box's own a\n");
    const before = where(box);
    expect(await follower(box, "your Mac")(before, want)).toEqual({ moved: false, why: "clash", reason: "1 uncommitted file clashes with newer commits (a.ts)" });
    expect(where(box)).toEqual(before);
    expect(at(box, "a.ts")).toBe("the box's own a\n");
    expect(git(box, "status", "--porcelain")).toBe("M a.ts");
  });

  it("names a few of many clashing files, a folder where a file should be among them", async () => {
    for (const f of ["c1.ts", "c2.ts", "c3.ts", "c4.ts"]) put(mac, f, "the Mac's\n");
    const want = commit();
    for (const f of ["c1.ts", "c2.ts", "c3.ts"]) put(box, f, "the box's\n");
    mkdirSync(path.join(box, "c4.ts"));
    put(box, "a.ts", "the box's own a\n");
    expect(await follower(box, "your Mac")(where(box), want)).toMatchObject({ why: "clash", reason: "5 uncommitted files clash with newer commits (a.ts, c1.ts, c2.ts and 2 more)" });
  });

  it("won't move to a commit that is only in this checkout, not on origin's branch", async () => {
    git(box, "checkout", "-q", "-b", "side");
    put(box, "b.ts", "on a side branch\n");
    git(box, "commit", "-qam", "side work");
    const side = git(box, "rev-parse", "HEAD");
    git(box, "checkout", "-q", "main");
    const before = where(box);
    expect(await follower(box, "your Mac")(before, side)).toMatchObject({ moved: false, why: "missing" });
    expect(where(box)).toEqual(before);
  });

  it("won't let the move remove a file that sits where the commit needs a folder, even an ignored one", async () => {
    put(mac, "dist/deep/x.ts", "x\n");
    git(mac, "add", "-f", "dist/deep/x.ts");
    const want = commit();
    put(box, "dist/deep", "an ignored file of the box's own\n");
    expect(await follower(box, "your Mac")(where(box), want)).toMatchObject({ moved: false, why: "clash", reason: "1 uncommitted file clashes with newer commits (dist/deep/x.ts)" });
    expect(at(box, "dist/deep")).toBe("an ignored file of the box's own\n");
  });

  it("gives a file that synced over the executable bit its commit has, and takes one away", async () => {
    put(mac, "run.sh", "#!/bin/sh\n");
    chmodSync(path.join(mac, "run.sh"), 0o755);
    put(mac, "plain.ts", "plain\n");
    const want = commit();
    put(box, "run.sh", "#!/bin/sh\n");
    put(box, "plain.ts", "plain\n");
    chmodSync(path.join(box, "plain.ts"), 0o755);
    expect(await follower(box, "your Mac")(where(box), want)).toEqual({ moved: true });
    expect(git(box, "status", "--porcelain")).toBe("");
    expect(statSync(path.join(box, "run.sh")).mode & 0o111).toBe(0o111);
    expect(statSync(path.join(box, "plain.ts")).mode & 0o111).toBe(0);
  });

  it("counts something else staged as this end's own work, and leaves the commit's version staged alone", async () => {
    const want = commit();
    // Staged: the box's own a.ts. On disk: the commit's.
    put(box, "a.ts", "the box's own a\n");
    git(box, "add", "a.ts");
    put(box, "a.ts", "a, edited\n");
    expect(await follower(box, "your Mac")(where(box), want)).toMatchObject({ moved: false, why: "clash" });
    expect(git(box, "show", ":a.ts")).toBe("the box's own a");
    // Staged and on disk: the commit's version, and its removal of gone.ts.
    git(box, "add", "a.ts");
    git(box, "rm", "-q", "gone.ts");
    expect(await follower(box, "your Mac")(where(box), want)).toEqual({ moved: true });
    expect(git(box, "status", "--porcelain")).toBe("");
  });

  it("leaves a symlink for git to judge", async () => {
    symlinkSync("a.ts", path.join(mac, "link"));
    const want = commit();
    expect(await follower(box, "your Mac")(where(box), want)).toEqual({ moved: true });
    expect(at(box, "link")).toBe("a, edited\n");
  });

  it("refuses a name that isn't a commit, and a checkout on no branch", async () => {
    const follow = follower(box, "your Mac");
    const head = where(box).head;
    expect(await follow(where(box), "--upload-pack=x")).toMatchObject({ moved: false, why: "failed" });
    expect(await follow({ branch: "main", head: "HEAD" }, head)).toMatchObject({ why: "failed" });
    expect(await follow({ branch: "", head }, head)).toMatchObject({ why: "failed" });
  });

  it("says so when git won't fast-forward, and unstages what it staged", async () => {
    const want = commit();
    const failing: Git = (cwd, args, e) => (args.includes("merge") ? Promise.reject(new Error("fatal: no\nmore")) : defaultGit(cwd, args, e));
    const follow = follower(box, "your Mac", { git: failing });
    expect(await follow(where(box), want)).toEqual({ moved: false, why: "failed", reason: `Couldn't move to commit ${want.slice(0, 7)}: fatal: no` });
    put(box, "new.ts", "new\n");
    expect(await follow(where(box), want)).toMatchObject({ why: "failed" });
    expect(git(box, "status", "--porcelain")).toBe("?? new.ts");
  });

  it("reads git's raw diff, skipping what isn't an entry", () => {
    const z = "0".repeat(40);
    const a = "a".repeat(40);
    const b = "b".repeat(40);
    expect(parseRaw(`:100644 100644 ${a} ${b} M\0x.ts\0:000000 100755 ${z} ${a} A\0new.sh\0:100644 000000 ${a} ${z} D\0old.ts\0:120000 120000 ${a} ${b} M\0link\0junk\0y\0`)).toEqual([
      { path: "x.ts", was: a, will: b, mode: "100644", plain: true },
      { path: "new.sh", was: null, will: a, mode: "100755", plain: true },
      { path: "old.ts", was: a, will: null, mode: "000000", plain: true },
      { path: "link", was: a, will: b, mode: "120000", plain: false },
    ]);
    expect(parseRaw("")).toEqual([]);
  });
});
