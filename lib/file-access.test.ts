// lib/file-access.ts: the editor column's server side. Real temp dirs and a real git init, so the
// 2 MB cap, the symlink escape, the binary sniff and the conflict check all run on real bytes.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_LIST, MAX_READ, headOf, listFiles, readFile, statFile, writeFile } from "./file-access";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-file-access-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }), 30_000);

// A repo for git operations: tracked and untracked files, a HEAD version different from
// the working tree, and no merge state.
let repo: string;
let other: string;
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

beforeAll(() => {
  repo = path.join(tmp, "repo");
  other = path.join(tmp, "other");
  fs.mkdirSync(repo);
  fs.mkdirSync(other);
  // Pin the branch: the test rewrites .git/HEAD to refs/heads/main, and CI's git defaults to master.
  git("init", "-b", "main");
  fs.writeFileSync(path.join(repo, "tracked.txt"), "tracked in HEAD\n");
  git("add", "tracked.txt");
  git("commit", "-m", "init");
  // The working tree has a different version than HEAD.
  fs.writeFileSync(path.join(repo, "tracked.txt"), "modified in worktree\n");
  fs.writeFileSync(path.join(repo, "untracked.txt"), "untracked file\n");
  fs.writeFileSync(path.join(repo, ".env"), "SECRET=123\n");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
  fs.writeFileSync(path.join(repo, "big.txt"), "x".repeat(MAX_READ + 1));
  // A real binary file (NUL byte in the first 8 KB).
  fs.writeFileSync(path.join(repo, "blob.bin"), Buffer.from([0, 1, 2, 0, 4, 5]));
  fs.writeFileSync(path.join(other, "outside.txt"), "lives outside the cwd\n");
});

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

describe("readFile", () => {
  it("returns the file's text, sha1, mtime and size", async () => {
    const file = await readFile(repo, "tracked.txt");
    expect(file).toMatchObject({
      path: "tracked.txt",
      exists: true,
      text: "modified in worktree\n",
      hash: sha1("modified in worktree\n"),
      size: "modified in worktree\n".length,
    });
    expect(typeof file.mtime).toBe("number");
  });

  it("returns exists:false for a missing file", async () => {
    const file = await readFile(repo, "nope.txt");
    expect(file).toEqual({ path: "nope.txt", exists: false, text: "", hash: null, mtime: null, size: 0 });
  });

  it("refuses a binary file", async () => {
    await expect(readFile(repo, "blob.bin")).rejects.toMatchObject({ code: "binary" });
  });

  it("refuses a file larger than MAX_READ", async () => {
    await expect(readFile(repo, "big.txt")).rejects.toMatchObject({ code: "binary" });
  });

  it("refuses .env and other secret files", async () => {
    await expect(readFile(repo, ".env")).rejects.toMatchObject({ code: "secret" });
  });

  it("refuses a file inside .git", async () => {
    await expect(readFile(repo, ".git/HEAD")).rejects.toMatchObject({ code: "git" });
  });

  it("refuses a path that escapes cwd", async () => {
    await expect(readFile(repo, "../other/outside.txt")).rejects.toMatchObject({ code: "outside" });
  });

  it("refuses an absolute path that escapes cwd", async () => {
    await expect(readFile(repo, path.join(other, "outside.txt"))).rejects.toMatchObject({ code: "outside" });
  });

  it("follows a symlink that points inside cwd", async () => {
    fs.symlinkSync(path.join(repo, "tracked.txt"), path.join(repo, "link.txt"));
    const file = await readFile(repo, "link.txt");
    expect(file.exists).toBe(true);
    expect(file.text).toBe("modified in worktree\n");
  });

  it("refuses a symlink that escapes cwd", async () => {
    fs.symlinkSync(other, path.join(repo, "escape"), "dir");
    await expect(readFile(repo, "escape/outside.txt")).rejects.toMatchObject({ code: "outside" });
  });
});

describe("statFile", () => {
  it("returns the file's mtime and size", async () => {
    const stat = await statFile(repo, "tracked.txt");
    expect(stat.exists).toBe(true);
    expect(typeof stat.mtime).toBe("number");
    expect(stat.size).toBe("modified in worktree\n".length);
  });

  it("returns exists:false for a missing file", async () => {
    const stat = await statFile(repo, "nope.txt");
    expect(stat).toEqual({ path: "nope.txt", exists: false, mtime: null, size: 0 });
  });

  it("refuses a path that escapes cwd", async () => {
    await expect(statFile(repo, "../other/outside.txt")).rejects.toMatchObject({ code: "outside" });
  });

  it("refuses a path inside .git", async () => {
    await expect(statFile(repo, ".git/HEAD")).rejects.toMatchObject({ code: "git" });
  });
});

describe("headOf", () => {
  it("returns the HEAD version of a tracked file", async () => {
    const head = await headOf(repo, "tracked.txt");
    expect(head).toEqual({ path: "tracked.txt", text: "tracked in HEAD\n" });
  });

  it("returns null for an untracked file", async () => {
    const head = await headOf(repo, "untracked.txt");
    expect(head).toEqual({ path: "untracked.txt", text: null });
  });

  it("returns null for a file that doesn't exist in HEAD or the tree", async () => {
    const head = await headOf(repo, "nope.txt");
    expect(head).toEqual({ path: "nope.txt", text: null });
  });

  it("returns null when the cwd isn't a git repo (and the file is inside cwd)", async () => {
    // `other` isn't a git repo: the file is inside cwd, safePath passes, git fails.
    const head = await headOf(other, "outside.txt");
    expect(head).toEqual({ path: "outside.txt", text: null });
  });

  it("refuses a path inside .git", async () => {
    await expect(headOf(repo, ".git/HEAD")).rejects.toMatchObject({ code: "git" });
  });
});

describe("listFiles", () => {
  it("lists tracked and untracked files, capped at MAX_LIST", async () => {
    const files = await listFiles(repo);
    expect(files).toContain("tracked.txt");
    expect(files).toContain("untracked.txt");
    expect(files).toContain(".env");
    expect(files).not.toContain(".git/HEAD");
  });

  it("falls back to a directory walk for a folder that isn't a repo", async () => {
    const files = await listFiles(other);
    expect(files).toEqual(["outside.txt"]);
  });

  it("skips node_modules, .git, .next and dist in the walk", async () => {
    const dir = path.join(tmp, "walk");
    fs.mkdirSync(path.join(dir, "node_modules", "x"), { recursive: true });
    fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
    fs.mkdirSync(path.join(dir, ".next"), { recursive: true });
    fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules", "x", "skip.js"), "x");
    fs.writeFileSync(path.join(dir, ".git", "x"), "x");
    fs.writeFileSync(path.join(dir, ".next", "x"), "x");
    fs.writeFileSync(path.join(dir, "dist", "x"), "x");
    fs.writeFileSync(path.join(dir, "keep.js"), "x");
    const files = await listFiles(dir);
    expect(files.sort()).toEqual(["keep.js"]);
  });

  it("caps the walk at MAX_LIST files", async () => {
    // The walk uses a counter, so we just need more files than the cap to prove the cap fires.
    const dir = path.join(tmp, "many");
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < MAX_LIST + 5; i++) fs.writeFileSync(path.join(dir, `f-${i}.txt`), "x");
    const files = await listFiles(dir);
    expect(files.length).toBe(MAX_LIST);
  }, 60_000);

  it("walks into nested directories and skips a directory the walker can't read", async () => {
    const dir = path.join(tmp, "nested");
    fs.mkdirSync(path.join(dir, "sub"), { recursive: true });
    fs.writeFileSync(path.join(dir, "top.txt"), "x");
    fs.writeFileSync(path.join(dir, "sub", "deep.txt"), "x");
    // A directory we can't read: the walker swallows the readdir error and continues
    // through its siblings. chmod 0 on a directory means "no permissions" for the
    // running user, including readdir.
    const locked = path.join(dir, "locked");
    fs.mkdirSync(locked);
    fs.writeFileSync(path.join(locked, "secret.txt"), "x");
    fs.chmodSync(locked, 0o000);
    try {
      const files = (await listFiles(dir)).sort();
      expect(files).toContain("top.txt");
      expect(files).toContain(path.join("sub", "deep.txt"));
      // The locked directory's contents are not visible; the walker just keeps going.
      expect(files).not.toContain(path.join("locked", "secret.txt"));
    } finally {
      fs.chmodSync(locked, 0o755);
    }
  }, 10_000);
});

describe("writeFile", () => {
  let scratch: string;
  beforeEach(() => {
    scratch = path.join(tmp, `write-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(scratch);
  });

  it("creates a new file and returns its hash and mtime", async () => {
    const out = await writeFile(scratch, "new.txt", "hello\n", null);
    expect(out).toEqual({ result: { hash: sha1("hello\n"), mtime: expect.any(Number) as unknown } });
    expect(fs.readFileSync(path.join(scratch, "new.txt"), "utf8")).toBe("hello\n");
  });

  it("overwrites a file with no baseHash", async () => {
    fs.writeFileSync(path.join(scratch, "new.txt"), "old\n");
    const out = await writeFile(scratch, "new.txt", "new\n");
    expect(out).toEqual({ result: { hash: sha1("new\n"), mtime: expect.any(Number) as unknown } });
    expect(fs.readFileSync(path.join(scratch, "new.txt"), "utf8")).toBe("new\n");
  });

  it("returns a conflict when the file changed since it was read", async () => {
    fs.writeFileSync(path.join(scratch, "live.txt"), "old\n");
    const baseHash = sha1("old\n");
    fs.writeFileSync(path.join(scratch, "live.txt"), "stale\n");
    const out = await writeFile(scratch, "live.txt", "new\n", baseHash);
    expect("conflict" in out).toBe(true);
    if ("conflict" in out) {
      expect(out.conflict.exists).toBe(true);
      expect(out.conflict.text).toBe("stale\n");
    }
    // The file on disk wasn't touched.
    expect(fs.readFileSync(path.join(scratch, "live.txt"), "utf8")).toBe("stale\n");
  });

  it("returns a conflict when baseHash is null and the file now exists", async () => {
    fs.writeFileSync(path.join(scratch, "live.txt"), "appeared\n");
    const out = await writeFile(scratch, "live.txt", "new\n", null);
    expect("conflict" in out).toBe(true);
    expect(fs.readFileSync(path.join(scratch, "live.txt"), "utf8")).toBe("appeared\n");
  });

  it("returns a conflict when the file was deleted between read and write", async () => {
    fs.writeFileSync(path.join(scratch, "live.txt"), "old\n");
    const baseHash = sha1("old\n");
    fs.rmSync(path.join(scratch, "live.txt"));
    const out = await writeFile(scratch, "live.txt", "new\n", baseHash);
    expect("conflict" in out).toBe(true);
    if ("conflict" in out) expect(out.conflict.exists).toBe(false);
  });

  it("creates missing parent directories", async () => {
    const out = await writeFile(scratch, "deep/nest/file.txt", "deep\n");
    expect("result" in out).toBe(true);
    expect(fs.readFileSync(path.join(scratch, "deep", "nest", "file.txt"), "utf8")).toBe("deep\n");
  });

  it("refuses to overwrite a secret file", async () => {
    fs.writeFileSync(path.join(scratch, ".env"), "old\n");
    await expect(writeFile(scratch, ".env", "new\n")).rejects.toMatchObject({ code: "secret" });
    expect(fs.readFileSync(path.join(scratch, ".env"), "utf8")).toBe("old\n");
  });

  it("refuses a path that escapes cwd", async () => {
    await expect(writeFile(scratch, "../escape.txt", "x")).rejects.toMatchObject({ code: "outside" });
  });

  it("refuses a path inside .git", async () => {
    fs.mkdirSync(path.join(scratch, ".git"));
    await expect(writeFile(scratch, ".git/HEAD", "x")).rejects.toMatchObject({ code: "git" });
  });

  it("cleans up the temp file when the rename fails (target is a directory)", async () => {
    // The target is a directory, so the .tmp file writes fine (its parent is scratch,
    // a real directory) but renaming onto a directory fails. The cleanup must remove
    // the stray .tmp so the next save doesn't trip over it.
    fs.mkdirSync(path.join(scratch, "is-a-dir"));
    await expect(writeFile(scratch, "is-a-dir", "x\n")).rejects.toThrow();
    const tmpFiles = (await fsp.readdir(scratch)).filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toEqual([]);
  });
});