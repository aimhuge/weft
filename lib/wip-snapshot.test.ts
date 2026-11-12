// Real git, two clones of one bare remote standing in for two Macs.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyWip, branchOf, fetchWip, pushWip, readSnapshot, snapshotWip, wipRef, worktreeTree } from "./wip-snapshot";

const A = "a".repeat(64);
const B = "b".repeat(64);
let dir: string;
let macA: string;
let macB: string;

const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const write = (root: string, file: string, text: string) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};
// `git status` as sorted lines; unstaged changes read "M file", as nothing is staged after a pickup.
const changes = (root: string) => sh(root, "status", "--porcelain").split("\n").map((line) => line.trim()).sort();
const read = (root: string, file: string) => readFileSync(path.join(root, file), "utf8");
const commit = (root: string, message: string) => {
  sh(root, "add", "-A");
  sh(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", message);
};
// A sends, B picks up.
async function move(from: string, fromId: string, to: string, toId: string, mac = "desk") {
  await snapshotWip(from, { device: fromId, mac });
  await pushWip(from, fromId);
  await fetchWip(to, fromId);
  return applyWip(to, fromId, toId);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "weft-wip-test-"));
  const origin = path.join(dir, "origin.git");
  macA = path.join(dir, "a");
  macB = path.join(dir, "b");
  sh(dir, "init", "-q", "--bare", "-b", "main", origin);
  sh(dir, "clone", "-q", origin, macA);
  write(macA, "kept.txt", "kept\n");
  write(macA, "gone.txt", "gone\n");
  write(macA, ".gitignore", "node_modules\n");
  commit(macA, "first");
  sh(macA, "push", "-q", "origin", "main");
  sh(dir, "clone", "-q", origin, macB);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("wipRef", () => {
  it("is a hidden ref per Mac, and only for a device id", () => {
    expect(wipRef(A)).toBe(`refs/weft/wip/${A}`);
    expect(wipRef("0f8c2a1e-7b3d-4c5e-9a6f-1b2c3d4e5f60")).toBe("refs/weft/wip/0f8c2a1e-7b3d-4c5e-9a6f-1b2c3d4e5f60");
    expect(() => wipRef("../heads/main")).toThrow("isn't one of your machines");
    expect(() => wipRef("-delete")).toThrow();
  });
});

describe("snapshotWip", () => {
  it("commits edits, deletions and untracked files on top of HEAD without touching the tree, the index or the branch", async () => {
    write(macA, "kept.txt", "edited\n");
    rmSync(path.join(macA, "gone.txt"));
    write(macA, "src/new.txt", "new\n");
    write(macA, "node_modules/x.js", "ignored\n");
    sh(macA, "add", "kept.txt");
    const status = sh(macA, "status", "--porcelain");
    const head = sh(macA, "rev-parse", "HEAD");
    const snap = await snapshotWip(macA, { device: A, mac: "desk" });
    expect(snap).toMatchObject({ head, mac: "desk", branch: "main", files: 3 });
    expect(snap.at).toBeGreaterThan(Date.now() - 60_000);
    expect(sh(macA, "rev-parse", wipRef(A))).toBe(snap.sha);
    expect(sh(macA, "ls-tree", "-r", "--name-only", snap.sha).split("\n")).toEqual([".gitignore", "kept.txt", "src/new.txt"]);
    expect(sh(macA, "status", "--porcelain")).toBe(status);
    expect(sh(macA, "rev-parse", "HEAD")).toBe(head);
  });

  it("leaves secret files as HEAD has them, and keeps their templates", async () => {
    write(macA, ".env", "KEY=1\n");
    write(macA, "app/.env.local", "KEY=2\n");
    write(macA, ".env.example", "KEY=\n");
    const snap = await snapshotWip(macA, { device: A, mac: "desk" });
    expect(sh(macA, "ls-tree", "-r", "--name-only", snap.sha).split("\n")).toEqual([".env.example", ".gitignore", "gone.txt", "kept.txt"]);
  });

  it("refuses a detached HEAD", async () => {
    sh(macA, "checkout", "-q", "--detach");
    await expect(snapshotWip(macA, { device: A, mac: "desk" })).rejects.toThrow("isn't on a branch");
    await expect(branchOf(macA)).rejects.toThrow("detached HEAD");
  });

  it("builds a tree in a repo that has no index yet", async () => {
    const bare = path.join(dir, "fresh");
    mkdirSync(bare);
    sh(bare, "init", "-q", "-b", "main");
    write(bare, "a.txt", "a\n");
    expect(await worktreeTree(bare)).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("readSnapshot", () => {
  it("is null for a commit Weft didn't make", async () => {
    expect(await readSnapshot(macA, "HEAD")).toBeNull();
    write(macA, "kept.txt", "more\n");
    sh(macA, "add", "-A");
    sh(macA, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "x", "-m", '{"mac":1}');
    expect(await readSnapshot(macA, "HEAD")).toBeNull();
    // Meta, but a root commit: no base to sit on.
    const root = sh(macA, "-c", "user.name=t", "-c", "user.email=t@t", "commit-tree", "HEAD^{tree}", "-m", "x", "-m", '{"mac":"m","branch":"main"}');
    expect(await readSnapshot(macA, root)).toBeNull();
  });
});

describe("fetchWip", () => {
  it("is null until that Mac has sent one", async () => {
    expect(await fetchWip(macB, A)).toBeNull();
    write(macA, "kept.txt", "edited\n");
    const snap = await snapshotWip(macA, { device: A, mac: "desk" });
    await pushWip(macA, A);
    expect(await fetchWip(macB, A)).toEqual(snap);
    // No branch moved on the remote.
    expect(sh(macB, "ls-remote", "--heads", "origin").split("\n")).toHaveLength(1);
  });
});

describe("applyWip", () => {
  it("puts the other Mac's uncommitted work in this tree, untracked files untracked", async () => {
    write(macA, "kept.txt", "edited\n");
    rmSync(path.join(macA, "gone.txt"));
    write(macA, "src/new.txt", "new\n");
    write(macB, ".env", "B=1\n");
    const applied = await move(macA, A, macB, B);
    expect(applied).toMatchObject({ mac: "desk", changed: 3, files: 3, install: false });
    expect(read(macB, "kept.txt")).toBe("edited\n");
    expect(existsSync(path.join(macB, "gone.txt"))).toBe(false);
    expect(read(macB, ".env")).toBe("B=1\n");
    expect(changes(macB)).toEqual(["?? .env", "?? src/", "D gone.txt", "M kept.txt"]);
    expect(sh(macB, "rev-parse", "HEAD")).toBe(sh(macA, "rev-parse", "HEAD"));
  });

  it("fast-forwards over commits the other Mac hasn't pushed, and says when a lockfile changed", async () => {
    write(macA, "pnpm-lock.yaml", "v2\n");
    commit(macA, "second, not pushed");
    write(macA, "kept.txt", "edited\n");
    const applied = await move(macA, A, macB, B);
    expect(applied).toMatchObject({ install: true, files: 1, changed: 2 });
    expect(sh(macB, "rev-parse", "main")).toBe(sh(macA, "rev-parse", "main"));
    expect(changes(macB)).toEqual(["M kept.txt"]);
  });

  it("goes back and forth: work already sent is replaced, and a file the other Mac deleted goes", async () => {
    write(macA, "draft.txt", "one\n");
    await move(macA, A, macB, B);
    write(macB, "kept.txt", "from b\n");
    rmSync(path.join(macB, "draft.txt"));
    const back = await move(macB, B, macA, A, "lap");
    expect(back).toMatchObject({ mac: "lap", changed: 2 });
    expect(read(macA, "kept.txt")).toBe("from b\n");
    expect(existsSync(path.join(macA, "draft.txt"))).toBe(false);
  });

  it("refuses to overwrite uncommitted work this Mac never sent", async () => {
    write(macA, "kept.txt", "edited\n");
    write(macB, "kept.txt", "mine\n");
    await expect(move(macA, A, macB, B)).rejects.toThrow("uncommitted work of its own in main. Commit it, or send it to desk first.");
    expect(read(macB, "kept.txt")).toBe("mine\n");
  });

  it("refuses another branch, commits the other Mac lacks, and a ref that isn't a snapshot", async () => {
    write(macA, "kept.txt", "edited\n");
    await snapshotWip(macA, { device: A, mac: "desk" });
    await pushWip(macA, A);
    await fetchWip(macB, A);
    sh(macB, "checkout", "-q", "-b", "other");
    await expect(applyWip(macB, A, B)).rejects.toThrow("desk's work is on main and this Mac is on other. Switch to main here first.");
    sh(macB, "checkout", "-q", "main");
    write(macB, "b.txt", "b\n");
    commit(macB, "only on b");
    await expect(applyWip(macB, A, B)).rejects.toThrow("has commits on main that desk doesn't");
    sh(macB, "update-ref", wipRef(A), "HEAD");
    await expect(applyWip(macB, A, B)).rejects.toThrow("isn't a snapshot Weft made");
  });
});
