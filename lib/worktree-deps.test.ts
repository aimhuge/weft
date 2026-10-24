import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cloneModules, installDeps, installerFor, lockHash } from "./worktree-deps";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-deps-")));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const dir = (name: string, files: Record<string, string> = {}) => {
  const d = path.join(tmp, name);
  fs.mkdirSync(d, { recursive: true });
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), text);
  }
  return d;
};

describe("installerFor", () => {
  it("picks the lockfile's own tool, never npm ci", () => {
    expect(installerFor(dir("p", { "pnpm-lock.yaml": "" }))).toMatchObject({ bin: "pnpm", lock: "pnpm-lock.yaml" });
    expect(installerFor(dir("n", { "package-lock.json": "{}" }))?.args).not.toContain("ci");
    expect(installerFor(dir("y", { "yarn.lock": "" }))?.bin).toBe("yarn");
    expect(installerFor(dir("none"))).toBeUndefined();
  });
});

describe("lockHash", () => {
  it("changes with the lockfile and is empty without one", () => {
    const d = dir("h", { "pnpm-lock.yaml": "a" });
    const before = lockHash(d);
    fs.writeFileSync(path.join(d, "pnpm-lock.yaml"), "b");
    expect(lockHash(d)).not.toBe(before);
    expect(lockHash(dir("none"))).toBe("");
  });
});

describe("cloneModules", () => {
  it("clones node_modules, and skips when there's none or the target has its own", async () => {
    const from = dir("from", { "node_modules/x/i.js": "1" });
    const to = dir("to");
    expect(await cloneModules(from, to)).toBe(true);
    expect(fs.readFileSync(path.join(to, "node_modules", "x", "i.js"), "utf8")).toBe("1");
    expect(await cloneModules(from, to)).toBe(false);
    expect(await cloneModules(dir("empty"), dir("to2"))).toBe(false);
  });

  it("cleans up and says false when the clone fails", async () => {
    const from = dir("bad", { "node_modules/x/i.js": "1" });
    const to = path.join(tmp, "missing-parent", "deeper");
    expect(await cloneModules(from, to)).toBe(false);
    expect(fs.existsSync(path.join(to, "node_modules"))).toBe(false);
  });
});

describe("installDeps", () => {
  it("says what it did with no lockfile", async () => {
    expect(await installDeps(dir("f1", { "node_modules/a/i.js": "1" }), dir("t1"), process.env)).toBe("cloned node_modules");
    expect(await installDeps(dir("f2"), dir("t2"), process.env)).toBe("no dependencies");
  });

  it("falls back and reports a failed install", async () => {
    const env = { ...process.env, PATH: "/nonexistent" };
    expect(await installDeps(dir("f3"), dir("t3", { "yarn.lock": "" }), env)).toBe("install failed");
    expect(await installDeps(dir("f4", { "node_modules/a/i.js": "1" }), dir("t4", { "yarn.lock": "" }), env)).toBe("cloned node_modules (install failed)");
  });
});
