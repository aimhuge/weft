import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// settled.sh against real git: a bare "origin" and a clone, all in a temp dir.
const SCRIPT = path.join(__dirname, "settled.sh");
let tmp: string;
let work: string;

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
function commit(name: string) {
  fs.writeFileSync(path.join(work, name), name);
  git(work, "add", name);
  git(work, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", name);
}
function settled(...files: string[]) {
  const r = spawnSync("bash", [SCRIPT, ...files], { cwd: work, encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-settled-"));
  work = path.join(tmp, "work");
  git(tmp, "init", "-q", "--bare", "-b", "main", "origin.git");
  git(tmp, "init", "-q", "-b", "main", "work");
  git(work, "remote", "add", "origin", path.join(tmp, "origin.git"));
  commit("a");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("settled.sh", () => {
  it("is settled once the session's files are committed and pushed", () => {
    git(work, "push", "-q", "-u", "origin", "main");
    const r = settled("a");
    expect(r.code).toBe(0);
    expect(r.out).toContain("matches origin/main");
  });

  it("ignores other cards' uncommitted files", () => {
    git(work, "push", "-q", "-u", "origin", "main");
    fs.writeFileSync(path.join(work, "theirs"), "x");
    expect(settled("a").code).toBe(0);
  });

  it("isn't settled with a session file changed, staged or new", () => {
    git(work, "push", "-q", "-u", "origin", "main");
    fs.writeFileSync(path.join(work, "a"), "changed");
    expect(settled("a")).toMatchObject({ code: 1, out: expect.stringContaining("1 session file(s)") as string });
    fs.writeFileSync(path.join(work, "new"), "n");
    expect(settled("new").code).toBe(1);
  });

  it("isn't settled with commits the upstream lacks", () => {
    git(work, "push", "-q", "-u", "origin", "main");
    commit("b");
    expect(settled("b")).toMatchObject({ code: 1, out: expect.stringContaining("1 commit(s) origin/main doesn't") as string });
  });

  it("isn't settled on a branch that was never pushed", () => {
    expect(settled("a")).toMatchObject({ code: 1, out: expect.stringContaining("never been pushed") as string });
  });

  it("is settled with no remote at all", () => {
    git(work, "remote", "remove", "origin");
    expect(settled("a")).toMatchObject({ code: 0, out: expect.stringContaining("nowhere to push") as string });
  });
});
