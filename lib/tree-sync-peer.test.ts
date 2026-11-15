import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { treeFs } from "./tree-sync-fs";
import { createPeer, type SyncPeer, type SyncStatus } from "./tree-sync-peer";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });

let tmp: string;
let x: string;
let y: string;
const peers: SyncPeer[] = [];

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "weft-tree-sync-"));
  const origin = path.join(tmp, "origin");
  mkdirSync(origin);
  git(origin, "init", "-q", "-b", "main");
  writeFileSync(path.join(origin, "a.ts"), "a\n");
  writeFileSync(path.join(origin, "old.ts"), "old\n");
  writeFileSync(path.join(origin, ".gitignore"), "node_modules/\n");
  git(origin, "add", "-A");
  git(origin, "commit", "-q", "-m", "init");
  x = path.join(tmp, "x");
  y = path.join(tmp, "y");
  git(tmp, "clone", "-q", origin, x);
  git(tmp, "clone", "-q", origin, y);
});

afterEach(() => {
  peers.splice(0).forEach((p) => p.stop());
  rmSync(tmp, { recursive: true, force: true });
});

// Two peers wired to each other; `prio` says who wins a clash.
function link(prio = { x: 1, y: 1 }) {
  const statuses: Record<"x" | "y", SyncStatus[]> = { x: [], y: [] };
  const make = (me: "x" | "y", root: string, other: () => SyncPeer) =>
    createPeer({
      fs: treeFs(root),
      self: { id: me === "x" ? "id-x" : "id-y", label: me === "x" ? "Mac" : "m1mini" },
      other: { id: me === "x" ? "id-y" : "id-x", label: me === "x" ? "m1mini" : "Mac" },
      send: (text) => queueMicrotask(() => other().receive(text)),
      prio: () => prio[me],
      gitDir: path.join(root, ".git"),
      onStatus: (s) => statuses[me].push(s),
      checkMs: 60_000,
      rescanMs: 60_000,
    });
  const px: SyncPeer = make("x", x, () => py);
  const py: SyncPeer = make("y", y, () => px);
  peers.push(px, py);
  return { px, py, statuses };
}

// Lets messages ping-pong until both ends are quiet.
async function settle(...ps: SyncPeer[]) {
  for (let i = 0; i < 20; i++) {
    await Promise.all(ps.map((p) => p.idle()));
    await new Promise((r) => setTimeout(r, 5));
  }
}

const at = (root: string, p: string) => (existsSync(path.join(root, p)) ? readFileSync(path.join(root, p), "utf8") : null);

describe("folder sync between two checkouts", () => {
  it("brings both ends level at hello, each way, and leaves secrets and ignored files alone", async () => {
    writeFileSync(path.join(x, "a.ts"), "a from x\n");
    writeFileSync(path.join(x, "new.ts"), "new\n");
    writeFileSync(path.join(x, ".env"), "SECRET=1\n");
    mkdirSync(path.join(x, "node_modules"));
    writeFileSync(path.join(x, "node_modules", "dep.js"), "dep\n");
    rmSync(path.join(y, "old.ts"));
    mkdirSync(path.join(y, "src"));
    writeFileSync(path.join(y, "src", "b.ts"), "b\n");
    const { px, py, statuses } = link();
    await Promise.all([px.start(), py.start()]);
    await settle(px, py);
    for (const root of [x, y]) {
      expect(at(root, "a.ts")).toBe("a from x\n");
      expect(at(root, "new.ts")).toBe("new\n");
      expect(at(root, "old.ts")).toBeNull();
      expect(at(root, "src/b.ts")).toBe("b\n");
    }
    expect(at(y, ".env")).toBeNull();
    expect(at(y, "node_modules/dep.js")).toBeNull();
    expect(statuses.y.at(-1)).toMatchObject({ kind: "synced" });
  });

  it("carries live edits, new folders, deletes and reverts", async () => {
    const { px, py } = link();
    await Promise.all([px.start(), py.start()]);
    await settle(px, py);
    mkdirSync(path.join(x, "lib"));
    writeFileSync(path.join(x, "lib", "c.ts"), "c\n");
    writeFileSync(path.join(x, "a.ts"), "edited\n");
    await px.touched(["lib/c.ts", "a.ts"]);
    await settle(px, py);
    expect(at(y, "lib/c.ts")).toBe("c\n");
    expect(at(y, "a.ts")).toBe("edited\n");
    rmSync(path.join(y, "lib"), { recursive: true });
    writeFileSync(path.join(y, "a.ts"), "a\n");
    await py.touched(["lib", "a.ts"]);
    await settle(px, py);
    expect(at(x, "lib/c.ts")).toBeNull();
    expect(at(x, "a.ts")).toBe("a\n");
    expect(git(x, "status", "--porcelain")).toBe("");
  });

  it("settles a clash on the end with threads running, the other keeping a copy", async () => {
    writeFileSync(path.join(x, "a.ts"), "x's\n");
    writeFileSync(path.join(y, "a.ts"), "y's\n");
    const { px, py, statuses } = link({ x: 1, y: 2 });
    await Promise.all([px.start(), py.start()]);
    await settle(px, py);
    expect(at(x, "a.ts")).toBe("y's\n");
    expect(at(y, "a.ts")).toBe("y's\n");
    expect(at(x, "a.conflict-mac.ts")).toBe("x's\n");
    // The copy is new work like any other, so it reaches the other end too.
    expect(at(y, "a.conflict-mac.ts")).toBe("x's\n");
    expect(statuses.x.at(-1)).toMatchObject({ kind: "synced", copies: ["a.conflict-mac.ts"] });
  });

  it("pauses when the two ends sit on different commits", async () => {
    writeFileSync(path.join(y, "a.ts"), "committed on y\n");
    git(y, "commit", "-qam", "y moves on");
    writeFileSync(path.join(x, "new.ts"), "new\n");
    const { px, py, statuses } = link();
    await Promise.all([px.start(), py.start()]);
    await settle(px, py);
    expect(at(y, "new.ts")).toBeNull();
    expect(statuses.x.at(-1)).toMatchObject({ kind: "paused" });
    expect((statuses.x.at(-1) as { reason: string }).reason).toMatch(/m1mini is at [0-9a-f]{7}/);
  });

  it("keeps its bases across lines, so work done while apart just flows", async () => {
    writeFileSync(path.join(x, "a.ts"), "shared\n");
    let { px, py } = link();
    await Promise.all([px.start(), py.start()]);
    await settle(px, py);
    await new Promise((r) => setTimeout(r, 600));
    px.stop();
    py.stop();
    // y edits while the line is down; x, the default winner by id... loses here only if it's a clash. It isn't.
    writeFileSync(path.join(y, "a.ts"), "y while apart\n");
    ({ px, py } = link());
    await Promise.all([px.start(), py.start()]);
    await settle(px, py);
    expect(at(x, "a.ts")).toBe("y while apart\n");
    expect(existsSync(path.join(x, "a.conflict-mac.ts"))).toBe(false);
  });
});
