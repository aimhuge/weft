import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const execFile = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile }));

import { inFolder, isThreadCli, parseLsof, parsePs, reapStrayClis } from "./cli-reaper";

const SDK = "/w/node_modules/@anthropic-ai";

type Reply = { stdout: string } | { err: { stdout?: string } };

// Routes the two commands the reaper runs; promisify(execFile) calls the mock as (file, args, cb).
function fakeExec(ps: string, lsof: Reply | null) {
  execFile.mockImplementation((file: string, _args: string[], cb: (e: unknown, r?: unknown) => void) => {
    if (file === "/bin/ps") cb(null, { stdout: ps, stderr: "" });
    else if (lsof && "err" in lsof) cb(lsof.err);
    else cb(null, { stdout: lsof ? lsof.stdout : "", stderr: "" });
  });
}

describe("parsePs", () => {
  it("parses good rows and skips blank and garbage lines", () => {
    const out = "  12     1 /usr/bin/Puku --x\n\ngarbage\n 34 12 node server.js\n";
    expect(parsePs(out)).toEqual([
      { pid: 12, ppid: 1, command: "/usr/bin/Puku --x" },
      { pid: 34, ppid: 12, command: "node server.js" },
    ]);
  });
});

describe("isThreadCli", () => {
  it("matches Puku, by path or bare", () => {
    expect(isThreadCli("Puku", SDK)).toBe(true);
    expect(isThreadCli("/path/Puku --flag", SDK)).toBe(true);
  });
  it("matches the puku-cli wrapper run through node", () => {
    expect(isThreadCli("node /x/bin/puku-cli --flags", SDK)).toBe(true);
    expect(isThreadCli("puku-cli", SDK)).toBe(true);
  });
  it("matches the SDK binary", () => {
    expect(isThreadCli(`${SDK}/claude-code/cli.js --x`, SDK)).toBe(true);
  });
  it("matches weft-launched codex (`exec --json` and `exec resume --json`)", () => {
    expect(isThreadCli("/usr/local/bin/codex exec --json --cd /a/weft", SDK)).toBe(true);
    expect(isThreadCli("codex exec resume --json ABC -", SDK)).toBe(true);
  });
  it("matches weft-launched Antigravity (`agy acp`) but not an interactive agy", () => {
    expect(isThreadCli("/Users/me/.local/bin/agy acp", SDK)).toBe(true);
    expect(isThreadCli("agy acp --login", SDK)).toBe(true);
    expect(isThreadCli("agy", SDK)).toBe(false);
    expect(isThreadCli("agy -p hello", SDK)).toBe(false);
  });
  it("does NOT match the codex app-server daemon or interactive codex", () => {
    expect(
      isThreadCli(
        "/Users/me/.codex/packages/app-server-daemon/releases/0.163.0/codex app-server --listen unix://",
        SDK,
      ),
    ).toBe(false);
    expect(isThreadCli("codex", SDK)).toBe(false);
    expect(isThreadCli("codex review", SDK)).toBe(false);
    expect(isThreadCli("codestream", SDK)).toBe(false);
  });
  it("rejects unrelated processes and look-alikes", () => {
    expect(isThreadCli("node server.js", SDK)).toBe(false);
    expect(isThreadCli("node /x/bin/puku-cli-other --a", SDK)).toBe(false);
  });
});

describe("parseLsof", () => {
  it("maps pids to cwds and ignores n lines before any pid", () => {
    const out = "n/orphan\np10\nfcwd\nn/a/weft\np20\nn/b\nx\n";
    expect([...parseLsof(out)]).toEqual([
      [10, "/a/weft"],
      [20, "/b"],
    ]);
  });
});

describe("inFolder", () => {
  it("matches exact, subfolder and trailing-slash folders but not sibling prefixes", () => {
    expect(inFolder("/a/weft", ["/a/weft"])).toBe(true);
    expect(inFolder("/a/weft/lib", ["/a/weft"])).toBe(true);
    expect(inFolder("/a/weft2", ["/a/weft"])).toBe(false);
    expect(inFolder("/a/weft/lib", ["/a/weft/"])).toBe(true);
    expect(inFolder("/a/weft2", ["/a/weft/"])).toBe(false);
    expect(inFolder("", ["/a/weft"])).toBe(false);
  });
});

describe("reapStrayClis", () => {
  let kill: MockInstance<typeof process.kill>;
  let log: MockInstance<typeof console.log>;

  beforeEach(() => {
    execFile.mockReset();
    kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    log = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns early on win32", async () => {
    const real = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      expect(await reapStrayClis(["/a/weft"], SDK)).toEqual([]);
    } finally {
      Object.defineProperty(process, "platform", real);
    }
    expect(execFile).not.toHaveBeenCalled();
  });

  it("returns early with no folders", async () => {
    expect(await reapStrayClis([], SDK)).toEqual([]);
    expect(execFile).not.toHaveBeenCalled();
  });

  it("uses the default sdkDir under cwd", async () => {
    fakeExec("5 1 node server.js\n", null);
    expect(await reapStrayClis(["/a/weft"])).toEqual([]);
  });

  it("returns [] without calling lsof when there are no orphans", async () => {
    fakeExec("5 7 /x/Puku\n6 1 node server.js\n", null);
    expect(await reapStrayClis(["/a/weft"], SDK)).toEqual([]);
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
  });

  it("kills only orphaned thread CLIs inside a Weft folder", async () => {
    const ps = "10 1 /x/Puku\n11 7 /x/Puku\n12 1 /x/Puku\n13 1 node /x/bin/puku-cli\n";
    fakeExec(ps, { stdout: "p10\nn/a/weft\np12\nn/other\np13\nn/a/weft/sub\n" });
    expect(await reapStrayClis(["/a/weft"], SDK)).toEqual([10, 13]);
    expect(kill).toHaveBeenCalledTimes(2);
    expect(kill).toHaveBeenCalledWith(10, "SIGKILL");
    expect(kill).toHaveBeenCalledWith(13, "SIGKILL");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("ended 2 thread CLI(s)"));
  });

  it("uses lsof's stdout when it exits nonzero", async () => {
    fakeExec("10 1 /x/Puku\n11 1 /x/Puku\n", { err: { stdout: "p10\nn/a/weft\n" } });
    expect(await reapStrayClis(["/a/weft"], SDK)).toEqual([10]);
  });

  it("kills nothing when lsof fails with no stdout", async () => {
    fakeExec("10 1 /x/Puku\n", { err: {} });
    expect(await reapStrayClis(["/a/weft"], SDK)).toEqual([]);
    expect(kill).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("ignores a pid that is already gone", async () => {
    fakeExec("10 1 /x/Puku\n", { stdout: "p10\nn/a/weft\n" });
    kill.mockImplementation(() => {
      throw new Error("ESRCH");
    });
    expect(await reapStrayClis(["/a/weft"], SDK)).toEqual([10]);
  });

  it("kills orphaned weft-launched codex threads but leaves the app-server daemon", async () => {
    const ps = [
      "10 1 /usr/local/bin/codex exec --json --cd /a/weft -", // matches: weft-launched, in folder
      "11 1 /usr/local/bin/codex exec --json --cd /other",  // matches: weft-launched, wrong folder
      "12 1 /Users/me/.codex/.../codex app-server --listen unix://", // daemon: never matched
      "13 1 /usr/local/bin/codex", // bare: never matched
    ].join("\n");
    fakeExec(ps, { stdout: "p10\nn/a/weft\np11\nn/other\np12\nn/a/weft\np13\nn/a/weft\n" });
    expect(await reapStrayClis(["/a/weft"], SDK)).toEqual([10]);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(10, "SIGKILL");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("ended 1 thread CLI(s)"));
  });
});
