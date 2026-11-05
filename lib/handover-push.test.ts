import { describe, expect, it, vi } from "vitest";
import { defaultGit, handoverBranch, inRepo, pushCardWork, type Git } from "./handover-push";

// A git that answers each subcommand from `out` and records the calls, with the index file each one used.
function fakeGit(out: Record<string, string> = {}) {
  const calls: { args: string[]; index?: string }[] = [];
  const git: Git = (_cwd, args, env) => {
    calls.push({ args, ...(env?.GIT_INDEX_FILE ? { index: env.GIT_INDEX_FILE } : {}) });
    const key = args[0] === "rev-parse" ? args.join(" ") : (args[0] as string);
    return Promise.resolve(out[key] ?? "");
  };
  return { git, calls };
}

const base = { "rev-parse --show-toplevel": "/repo\n", "rev-parse HEAD": "head1\n" };

describe("handoverBranch", () => {
  it("is Weft's own branch per card", () => {
    expect(handoverBranch("0123456789abcdef")).toBe("weft/handover/01234567");
  });
});

describe("inRepo", () => {
  it("makes paths repo-relative once each, dropping the ones outside it", () => {
    expect(inRepo(["/repo"], ["/repo/lib/a.ts", "lib/a.ts", "/other/b.ts", "/repo", "../c.ts"])).toEqual(["lib/a.ts"]);
    expect(inRepo(["/private/var/r", "/var/r"], ["/var/r/a.ts", "/private/var/r/b.ts"])).toEqual(["a.ts", "b.ts"]);
  });
});

describe("pushCardWork", () => {
  it("commits the card's changed files on top of HEAD in a throwaway index and pushes that", async () => {
    const { git, calls } = fakeGit({ ...base, status: " M lib/a.ts\0?? lib/new.ts\0R  lib/b2.ts\0lib/b.ts\0", "write-tree": "tree1\n", "commit-tree": "sha1\n" });
    const out = await pushCardWork("/repo/sub", ["/repo/lib/a.ts", "/repo/lib/new.ts", "/repo/lib/b2.ts", "/outside/x.ts"], "weft/handover/abc", "msg", git);
    expect(out).toEqual({ branch: "weft/handover/abc", sha: "sha1", files: ["lib/a.ts", "lib/new.ts", "lib/b2.ts"] });
    expect(calls.map((c) => c.args)).toEqual([
      ["rev-parse", "--show-toplevel"],
      ["rev-parse", "--show-cdup"],
      ["rev-parse", "HEAD"],
      ["status", "--porcelain", "-z", "--untracked-files=all", "--", "lib/a.ts", "lib/new.ts", "lib/b2.ts"],
      ["read-tree", "HEAD"],
      ["add", "-A", "--", "lib/a.ts", "lib/new.ts", "lib/b2.ts"],
      ["write-tree"],
      ["commit-tree", "tree1", "-p", "head1", "-m", "msg"],
      ["push", "--force", "origin", "sha1:refs/heads/weft/handover/abc"],
    ]);
    // The index steps all used one throwaway index; nothing else touched the real one.
    const indexes = calls.filter((c) => c.index).map((c) => c.args[0]);
    expect(indexes).toEqual(["read-tree", "add", "write-tree"]);
    expect(new Set(calls.flatMap((c) => (c.index ? [c.index] : []))).size).toBe(1);
  });

  it("pushes HEAD itself when the card changed nothing", async () => {
    const { git, calls } = fakeGit(base);
    expect(await pushCardWork("/repo", ["/repo/lib/a.ts"], "b", "m", git)).toEqual({ branch: "b", sha: "head1", files: [] });
    expect(calls.map((c) => c.args[0])).toEqual(["rev-parse", "rev-parse", "rev-parse", "status", "push"]);
    const none = fakeGit(base);
    await pushCardWork("/repo", [], "b", "m", none.git);
    expect(none.calls.map((c) => c.args[0])).toEqual(["rev-parse", "rev-parse", "rev-parse", "push"]);
  });

  it("cleans up its index when a step fails", async () => {
    const git: Git = (_cwd, args) => (args[0] === "write-tree" ? Promise.reject(new Error("bad tree")) : Promise.resolve(args[0] === "status" ? " M a.ts\0" : args[1] === "--show-toplevel" ? "/repo" : args[1] === "--show-cdup" ? "" : "x"));
    await expect(pushCardWork("/repo", ["/repo/a.ts"], "b", "m", git)).rejects.toThrow("bad tree");
  });
});

describe("defaultGit", () => {
  it("runs git with no password prompt and gives its output", async () => {
    expect((await defaultGit(process.cwd(), ["--version"])).startsWith("git version")).toBe(true);
  });

  it("rejects with git's own words", async () => {
    await expect(defaultGit(process.cwd(), ["not-a-command"])).rejects.toThrow(/not-a-command/);
  });

  it("falls back to the error's message when git says nothing", async () => {
    vi.resetModules();
    vi.doMock("node:child_process", () => ({ execFile: (_f: string, _a: string[], _o: unknown, cb: (e: Error, out: string, err: string) => void) => cb(new Error("spawn failed"), "", "") }));
    const { defaultGit: g } = await import("./handover-push");
    await expect(g("/", ["status"])).rejects.toThrow("spawn failed");
    vi.doUnmock("node:child_process");
  });
});

describe("pushCardWork in a real repo", () => {
  it("pushes the card's edits to the branch and leaves the working tree, index and branch as they were", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = mkdtempSync(path.join(os.tmpdir(), "weft-handover-test-"));
    const repo = path.join(dir, "repo");
    const remote = path.join(dir, "remote.git");
    const g = (cwd: string, ...args: string[]) => defaultGit(cwd, args);
    try {
      await g(dir, "init", "--bare", "-q", remote);
      await g(dir, "init", "-q", "-b", "main", repo);
      for (const [k, v] of [["user.email", "t@t"], ["user.name", "T"], ["commit.gpgsign", "false"]]) await g(repo, "config", k as string, v as string);
      await g(repo, "remote", "add", "origin", remote);
      writeFileSync(path.join(repo, "a.txt"), "one\n");
      writeFileSync(path.join(repo, "other.txt"), "theirs\n");
      await g(repo, "add", ".");
      await g(repo, "commit", "-q", "-m", "init");
      // The card edited a.txt and made new.txt; another card edited other.txt and staged it.
      writeFileSync(path.join(repo, "a.txt"), "two\n");
      writeFileSync(path.join(repo, "new.txt"), "fresh\n");
      writeFileSync(path.join(repo, "other.txt"), "someone else's\n");
      await g(repo, "add", "other.txt");
      const before = await g(repo, "status", "--porcelain");
      const pushed = await pushCardWork(repo, [path.join(repo, "a.txt"), path.join(repo, "new.txt")], "weft/handover/test", "handover", defaultGit);
      expect(pushed.files.sort()).toEqual(["a.txt", "new.txt"]);
      expect(await g(repo, "status", "--porcelain")).toBe(before);
      expect((await g(repo, "rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe("main");
      expect(await g(remote, "show", "weft/handover/test:a.txt")).toBe("two\n");
      expect(await g(remote, "show", "weft/handover/test:new.txt")).toBe("fresh\n");
      expect(await g(remote, "show", "weft/handover/test:other.txt")).toBe("theirs\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
