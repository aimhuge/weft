import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// githubRepoOf on hand-made .git folders in a temp dir (lib/repos.test.ts is at its size cap).
vi.mock("./settings", () => ({ listProjects: () => [] }));
const { githubRepoOf } = await import("./repos");

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-origin-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("githubRepoOf", () => {
  it("reads a folder's GitHub origin, through a worktree too, and nothing for a plain folder", () => {
    const main = path.join(root, "app");
    fs.mkdirSync(path.join(main, ".git", "worktrees", "wt"), { recursive: true });
    fs.writeFileSync(path.join(main, ".git", "config"), '[remote "origin"]\n\turl = git@github.com:me/app.git\n');
    fs.writeFileSync(path.join(main, ".git", "worktrees", "wt", "commondir"), "../..\n");
    const wt = path.join(root, "wt");
    fs.mkdirSync(wt);
    fs.writeFileSync(path.join(wt, ".git"), `gitdir: ${path.join(main, ".git", "worktrees", "wt")}\n`);
    const plain = path.join(root, "plain");
    fs.mkdirSync(plain);
    expect(githubRepoOf(main)).toBe("me/app");
    expect(githubRepoOf(wt)).toBe("me/app");
    expect(githubRepoOf(plain)).toBeUndefined();
  });
});
