import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { materialise, type Exec } from "./worker-paths";

// materialise against the real git: a local repo stands in for the remote, which isGitUrl would refuse by path.
const URL = "https://example.test/a/b.git";
const run = promisify(execFile);

let root: string;
let work: string;
let dir: string;

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: "ignore" });

function makeRepo(files: Record<string, string>) {
  const repo = path.join(root, "src");
  fs.mkdirSync(repo);
  git(repo, "init", "-q");
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), text);
  }
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "first");
  return repo;
}

// Real git, with the fake URL swapped for the local repo. `failing` names the first arg that should fail.
const realGit = (repo: string, failing?: string): Exec =>
  (cmd, args, opts) => {
    if (failing && args.includes(failing)) return Promise.reject(new Error(`git: '${failing}' is not a git command.`));
    return run(cmd, args.map((a) => (a === URL ? repo : a)), opts);
  };

const leftovers = () => fs.readdirSync(work).filter((name) => name !== "weft");

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-worker-clone-"));
  work = path.join(root, "work");
  dir = path.join(work, "weft");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("materialise with real git", () => {
  it("leaves a complete checkout, and no temp folder", async () => {
    const repo = makeRepo({ "a.txt": "hello\n", "sub/b.txt": "there\n" });
    expect(await materialise(dir, URL, realGit(repo))).toBe("cloned");
    expect(fs.readFileSync(path.join(dir, "sub/b.txt"), "utf8")).toBe("there\n");
    expect(execFileSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8" })).toBe("");
    expect(leftovers()).toEqual([]);
  });

  it("clones an empty repo", async () => {
    const repo = path.join(root, "src");
    fs.mkdirSync(repo);
    git(repo, "init", "-q");
    expect(await materialise(dir, URL, realGit(repo))).toBe("cloned");
    expect(fs.existsSync(path.join(dir, ".git"))).toBe(true);
  });

  it("refuses an LFS repo on a box with no git-lfs, with nothing left behind", async () => {
    const repo = makeRepo({ ".gitattributes": "*.bin filter=lfs diff=lfs merge=lfs -text\n", "a.txt": "hello\n" });
    await expect(materialise(dir, URL, realGit(repo, "lfs"))).rejects.toThrow(`${URL} stores files in Git LFS, and this worker doesn't have git-lfs.`);
    expect(fs.existsSync(dir)).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it("finds LFS in a nested .gitattributes", async () => {
    const repo = makeRepo({ "assets/.gitattributes": "*.bin filter=lfs -text\n" });
    await expect(materialise(dir, URL, realGit(repo, "lfs"))).rejects.toThrow("stores files in Git LFS");
  });

  it("leaves no folder when the checkout fails, so a resend clones again", async () => {
    const repo = makeRepo({ "a.txt": "hello\n" });
    await expect(materialise(dir, URL, realGit(repo, "reset"))).rejects.toThrow("'reset' is not a git command");
    expect(fs.existsSync(dir)).toBe(false);
    expect(leftovers()).toEqual([]);
    expect(await materialise(dir, URL, realGit(repo))).toBe("cloned");
  });
});
