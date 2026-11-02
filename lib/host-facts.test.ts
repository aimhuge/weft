import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countBehind, hostFacts, hostTz, macHint, noteUpstream, osLabel, RECOUNT_MS, resetHostFacts, setWorkerName, warmHostFacts, type Git } from "./host-facts";

let dir: string;
const flush = () => new Promise((r) => setTimeout(r, 0));

// A fake git: HEAD is abc1234, origin/main 3 ahead.
const fakeGit = (behind = "3\n"): Git & { calls: string[][] } => {
  const calls: string[][] = [];
  const git = ((args: string[]) => {
    calls.push(args);
    return Promise.resolve(args[0] === "rev-parse" ? "abc1234\n" : behind);
  }) as unknown as Git & { calls: string[][] };
  git.calls = calls;
  return git;
};

beforeEach(() => {
  resetHostFacts();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "host-facts-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "0.7.0" }));
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("osLabel", () => {
  it("names macOS, Linux and anything else", () => {
    expect(osLabel("darwin", "25.3.0", "arm64")).toBe("macOS (Darwin 25.3.0, arm64)");
    expect(osLabel("linux", "6.8.0", "x64")).toBe("Linux 6.8.0 (x64)");
    expect(osLabel("win32", "10", "x64")).toBe("win32 10 (x64)");
    expect(osLabel()).toContain(os.release());
  });
});

describe("hostFacts", () => {
  it("on a Mac: its host name, version, and the commit and behind count once git answers", async () => {
    const git = fakeGit();
    const first = hostFacts({}, dir, RECOUNT_MS + 1, git);
    expect(first).toEqual({ worker: false, name: os.hostname().replace(/\.local$/, ""), os: osLabel(), version: "0.7.0" });
    await flush();
    const later = hostFacts({}, dir, RECOUNT_MS + 2, git);
    expect(later).toMatchObject({ commit: "abc1234", behind: 3 });
    expect(later.checkedAt).toBeGreaterThan(0);
    // Counted once until RECOUNT_MS has passed, then again in the background.
    expect(git.calls).toHaveLength(2);
    hostFacts({}, dir, 3 * RECOUNT_MS, git);
    expect(git.calls).toHaveLength(3);
  });

  it("on a worker: its enrolled name, and only its update loop counts", () => {
    const git = fakeGit();
    setWorkerName("mini-1");
    expect(hostFacts({ WEFT_WORKER: "1" }, dir, RECOUNT_MS * 5, git)).toMatchObject({ worker: true, name: "mini-1" });
    expect(git.calls).toHaveLength(0);
    noteUpstream(0, 1000);
    expect(hostFacts({ WEFT_WORKER: "1" }, dir, 0, git)).toMatchObject({ behind: 0, checkedAt: 1000 });
  });

  it("a worker with no name yet goes by its host name", () => {
    expect(hostFacts({ WEFT_WORKER: "1" }, dir, 0).name).toBe(os.hostname().replace(/\.local$/, ""));
  });

  it("a packaged build: the version and commit from NEXT_PUBLIC_APP_VERSION, else unknown", () => {
    fs.rmSync(path.join(dir, "package.json"));
    expect(hostFacts({ NEXT_PUBLIC_APP_VERSION: "0.6.7+def5678" }, dir, 0)).toMatchObject({ version: "0.6.7", commit: "def5678" });
    resetHostFacts();
    expect(hostFacts({ NEXT_PUBLIC_APP_VERSION: "0.6.7" }, dir, 0)).not.toHaveProperty("commit");
    resetHostFacts();
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: 7 }));
    expect(hostFacts({}, dir, 0).version).toBe("unknown");
  });
});

describe("countBehind", () => {
  it("dates the count by the last fetch when FETCH_HEAD is there", async () => {
    fs.mkdirSync(path.join(dir, ".git"));
    fs.writeFileSync(path.join(dir, ".git", "FETCH_HEAD"), "");
    const at = new Date("2026-11-01T10:00:00Z");
    fs.utimesSync(path.join(dir, ".git", "FETCH_HEAD"), at, at);
    await countBehind(dir, fakeGit("0\n"), 5);
    expect(hostFacts({ WEFT_WORKER: "1" }, dir, 0)).toMatchObject({ commit: "abc1234", behind: 0, checkedAt: at.getTime() });
  });

  it("says nothing new when git fails or answers nonsense, and doesn't run twice at once", async () => {
    const failing: Git = () => Promise.reject(new Error("not a git repository"));
    await countBehind(dir, failing);
    expect(hostFacts({ WEFT_WORKER: "1" }, dir, 0)).not.toHaveProperty("behind");
    await countBehind(dir, fakeGit("lots"));
    expect(hostFacts({ WEFT_WORKER: "1" }, dir, 0)).not.toHaveProperty("behind");
    const git = fakeGit();
    const one = countBehind(dir, git);
    await countBehind(dir, git);
    await one;
    expect(git.calls).toHaveLength(2);
  });

  it("an empty commit answer is no commit", async () => {
    await countBehind(dir, (args) => Promise.resolve(args[0] === "rev-parse" ? "\n" : "0\n"));
    expect(hostFacts({ WEFT_WORKER: "1" }, dir, 0)).not.toHaveProperty("commit");
  });

  it("runs real git by default: a folder that isn't a checkout just says less", async () => {
    await countBehind(dir);
    expect(hostFacts({ WEFT_WORKER: "1" }, dir, 0)).not.toHaveProperty("commit");
  });
});

describe("warmHostFacts", () => {
  it("reads once per process", async () => {
    const git = fakeGit();
    const a = warmHostFacts(dir, git);
    expect(warmHostFacts(dir, git)).toBe(a);
    await a;
    expect(git.calls).toHaveLength(2);
  });
});

describe("macHint", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is this Mac's desktop board, its zone and the relay", () => {
    expect(macHint()).toEqual({ app: "desktop", name: os.hostname().replace(/\.local$/, ""), tz: hostTz(), via: "relay" });
  });

  it("leaves out a zone that isn't one", () => {
    hostFacts({}, dir, 0);
    vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({ resolvedOptions: () => ({ timeZone: "no zone" }) } as unknown as Intl.DateTimeFormat);
    expect(macHint()).not.toHaveProperty("tz");
  });
});
