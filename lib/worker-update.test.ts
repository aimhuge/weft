import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUpdater, runCommand, updatesOn, type Run } from "./worker-update";

const ROLLBACK = path.join(process.cwd(), "install", "worker-rollback.sh");
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();

let root: string;
let origin: string;
let home: string;
let dir: string;

function commit(file: string, text: string) {
  fs.writeFileSync(path.join(origin, file), text);
  git(origin, "add", ".");
  git(origin, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", file);
  return git(origin, "rev-parse", "HEAD");
}

// The real git, against a real origin; only pnpm and the load check are stood in for.
function updater(fail: { install?: boolean; check?: boolean } = {}) {
  const calls: string[] = [];
  const run: Run = (cmd, args, opts) => {
    if (cmd === "git") return runCommand(cmd, args, opts);
    const step = cmd === "pnpm" ? "install" : "check";
    calls.push(step);
    return fail[step] ? Promise.reject(new Error(`${step} broke\nsecond line`)) : Promise.resolve("");
  };
  return { up: createUpdater({ home, dir, run, log: vi.fn() }), calls };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "worker-update-"));
  origin = path.join(root, "origin");
  home = path.join(root, "home");
  dir = path.join(home, "weft");
  fs.mkdirSync(origin);
  fs.mkdirSync(home);
  git(origin, "init", "-q", "-b", "main");
  fs.mkdirSync(path.join(origin, "install"));
  fs.copyFileSync(ROLLBACK, path.join(origin, "install", "worker-rollback.sh"));
  commit("package.json", '{"version":"0.6.6"}');
  // As install/worker.sh clones it.
  git(root, "clone", "-q", "--depth", "1", `file://${origin}`, dir);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("updatesOn", () => {
  it("runs only in the worker's own clone, unless switched off", () => {
    const env = (vars: Record<string, string> = {}) => vars as unknown as NodeJS.ProcessEnv;
    expect(updatesOn("/h/.weft-worker", "/h/.weft-worker/weft", env())).toBe(true);
    expect(updatesOn("/h/.weft-worker", "/h/dev/weft", env())).toBe(false);
    expect(updatesOn("/h/.weft-worker", "/h/.weft-worker/weft", env({ WEFT_WORKER_AUTO_UPDATE: "0" }))).toBe(false);
  });
});

describe("runCommand", () => {
  it("returns stdout, and rejects with stderr", async () => {
    const opts = { cwd: root, timeoutMs: 10_000 };
    await expect(runCommand(process.execPath, ["-e", "console.log('hi')"], opts)).resolves.toBe("hi\n");
    await expect(runCommand(process.execPath, ["-e", "console.error('nope'); process.exit(1)"], opts)).rejects.toThrow("nope");
    await expect(runCommand(process.execPath, ["-e", "process.exit(1)"], opts)).rejects.toThrow("Command failed");
  });
});

describe("the updater", () => {
  it("does nothing when it's on the newest commit", async () => {
    const { up, calls } = updater();
    const hold = vi.fn(() => true);
    expect(await up.tick(hold)).toEqual({ restart: false, note: null });
    expect(hold).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("moves a shallow clone to the new commit, proves it loads, and asks for a restart", async () => {
    const target = commit("a.txt", "new");
    fs.writeFileSync(path.join(origin, "install", "worker-rollback.sh"), "# newer\n");
    const newest = (git(origin, "add", "."), git(origin, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "r"), git(origin, "rev-parse", "HEAD"));
    expect(newest).not.toBe(target);
    const { up, calls } = updater();
    expect(await up.tick(() => true)).toEqual({ restart: true, note: null });
    expect(git(dir, "rev-parse", "HEAD")).toBe(newest);
    expect(calls).toEqual(["install", "check"]);
    expect(fs.readFileSync(path.join(home, "update-trial"), "utf8").split("\n")[1]).toBe(newest);
    expect(fs.readFileSync(path.join(home, "rollback.sh"), "utf8")).toBe("# newer\n");
    expect(await up.build()).toBe(`0.6.6+${newest.slice(0, 7)}`);
  });

  it("waits for a card, and leaves the clone alone", async () => {
    const target = commit("a.txt", "new");
    const { up, calls } = updater();
    const before = git(dir, "rev-parse", "HEAD");
    expect(await up.tick(() => false)).toEqual({ restart: false, note: `Update to ${target.slice(0, 7)} is waiting for a card to finish.` });
    expect(git(dir, "rev-parse", "HEAD")).toBe(before);
    expect(calls).toEqual([]);
  });

  it("goes back and skips a commit that doesn't load", async () => {
    const before = git(dir, "rev-parse", "HEAD");
    const target = commit("a.txt", "new");
    const { up, calls } = updater({ check: true });
    const first = await up.tick(() => true);
    expect(first).toEqual({ restart: false, note: `Skipping ${target.slice(0, 7)}: it doesn't load. check broke` });
    expect(git(dir, "rev-parse", "HEAD")).toBe(before);
    expect(fs.existsSync(path.join(home, "update-trial"))).toBe(false);
    expect(calls).toEqual(["install", "check", "install"]);
    expect(await up.tick(() => true)).toEqual(first);
    expect(calls).toHaveLength(3);
  });

  it("goes back after a failed install, and tries the same commit next time", async () => {
    const before = git(dir, "rev-parse", "HEAD");
    const target = commit("a.txt", "new");
    const failing = updater({ install: true });
    expect(await failing.up.tick(() => true)).toEqual({ restart: false, note: `Stayed on ${before.slice(0, 7)}: installing ${target.slice(0, 7)} failed. install broke` });
    expect(git(dir, "rev-parse", "HEAD")).toBe(before);
    expect(fs.existsSync(path.join(home, "update-bad"))).toBe(false);
    expect((await updater().up.tick(() => true)).restart).toBe(true);
  });

  it("refuses local changes, another branch, and a clone ahead of main", async () => {
    commit("a.txt", "new");
    const { up } = updater();
    fs.writeFileSync(path.join(dir, "mine.txt"), "x");
    expect((await up.tick(() => true)).note).toBe("Not updating: the clone has local changes.");
    fs.rmSync(path.join(dir, "mine.txt"));
    git(dir, "checkout", "-q", "-b", "other");
    expect((await up.tick(() => true)).note).toBe("Not updating: the clone isn't on main.");
    git(dir, "checkout", "-q", "main");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "local");
    expect((await up.tick(() => true)).note).toBe("Not updating: the clone has moved past main.");
  });

  it("clears the trial once healthy", () => {
    fs.writeFileSync(path.join(home, "update-trial"), "a\nb\n");
    fs.writeFileSync(path.join(home, "update-trial.starts"), "start\n");
    updater().up.healthy();
    expect(fs.readdirSync(home)).toEqual(["weft"]);
  });
});

describe("install/worker-rollback.sh", () => {
  function start() {
    // pnpm is on the box; here a stub stands in for it.
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "pnpm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    return spawnSync("sh", [ROLLBACK, home, dir], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  }

  it("does nothing with no trial", () => {
    expect(start().status).toBe(0);
    expect(fs.existsSync(path.join(home, "update-trial.starts"))).toBe(false);
  });

  it("gives a new commit three starts, then goes back and marks it bad", async () => {
    const before = git(dir, "rev-parse", "HEAD");
    const target = commit("a.txt", "new");
    await updater().up.tick(() => true);
    expect(git(dir, "rev-parse", "HEAD")).toBe(target);
    for (let i = 0; i < 3; i++) start();
    expect(git(dir, "rev-parse", "HEAD")).toBe(target);
    start();
    expect(git(dir, "rev-parse", "HEAD")).toBe(before);
    expect(fs.existsSync(path.join(home, "update-trial"))).toBe(false);
    expect(fs.existsSync(path.join(home, "update-trial.starts"))).toBe(false);
    const { up } = updater();
    expect((await up.tick(() => true)).note).toBe(`Skipping ${target.slice(0, 7)}: it died at start.`);
  });
});
