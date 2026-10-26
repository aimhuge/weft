import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dirtyFiles, parsePorcelain, repoRoot, writtenAt, writtenSince } from "./dirty-files";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-dirty-")));
const repo = path.join(tmp, "repo");
const outside = path.join(tmp, "plain");
fs.mkdirSync(repo);
fs.mkdirSync(outside);
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
git("init", "-q");
git("config", "user.email", "t@example.com");
git("config", "user.name", "T");
fs.writeFileSync(path.join(repo, "kept.ts"), "1\n");
fs.writeFileSync(path.join(repo, "changed.ts"), "1\n");
git("add", ".");
git("commit", "-qm", "init");

describe("repoRoot", () => {
  it("finds the repo from a folder inside it", () => {
    fs.mkdirSync(path.join(repo, "sub"), { recursive: true });
    expect(repoRoot(path.join(repo, "sub"))).toBe(repo);
  });

  it("is undefined outside git", () => {
    expect(repoRoot(outside)).toBeUndefined();
  });
});

describe("parsePorcelain", () => {
  it("reads each entry's path, skips a rename's old path and short entries", () => {
    expect(parsePorcelain(" M a.ts\0?? new.ts\0R  to.ts\0from.ts\0x\0\0")).toEqual(["a.ts", "new.ts", "to.ts"]);
  });

  it("is empty for a clean tree", () => {
    expect(parsePorcelain("")).toEqual([]);
  });
});

describe("dirtyFiles", () => {
  it("lists changed and untracked files, absolute, not clean ones", () => {
    fs.writeFileSync(path.join(repo, "changed.ts"), "2\n");
    fs.writeFileSync(path.join(repo, "sub", "untracked.ts"), "x\n");
    const dirty = dirtyFiles(repo);
    expect(dirty).toEqual(expect.arrayContaining([path.join(repo, "changed.ts"), path.join(repo, "sub", "untracked.ts")]));
    expect(dirty).not.toContain(path.join(repo, "kept.ts"));
  });

  it("is undefined, not empty, when git can't read the folder", () => {
    expect(dirtyFiles(outside)).toBeUndefined();
  });
});

describe("writtenSince", () => {
  it("keeps files written at or after the time, drops older and missing ones", () => {
    const old = path.join(repo, "kept.ts");
    const fresh = path.join(repo, "changed.ts");
    fs.utimesSync(old, new Date(1000), new Date(1000));
    const since = Date.now() - 1000;
    fs.utimesSync(fresh, new Date(), new Date());
    expect(writtenSince([old, fresh, path.join(repo, "gone.ts")], since)).toEqual([fresh]);
    expect(writtenAt([old, fresh], since)).toEqual(new Map([[fresh, fs.statSync(fresh).mtimeMs]]));
  });
});
