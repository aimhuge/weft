import { beforeEach, describe, expect, it, vi } from "vitest";

// The Windows branches of the CLI lookups and kills (lib/win-command.ts does the work): no /usr/bin/which,
// .cmd shims through cmd.exe, taskkill for a process tree. Run on any OS with Windows faked in.

type WinState = { found: string | null; killed: number[]; kills: boolean };
const win = vi.hoisted((): WinState => ({ found: "C:\\npm\\codex.cmd", killed: [], kills: true }));

vi.mock("./win-command", async (importOriginal) => {
  const real = await importOriginal<typeof import("./win-command")>();
  return {
  ...real,
  isWindows: () => true,
  spawnPlan: (command: string, args: string[], opts: { env?: NodeJS.ProcessEnv } = {}) => real.spawnPlan(command, args, { ...opts, platform: "win32" }),
  findOnWindowsPath: () => win.found,
  killTree: (pid: number) => (win.killed.push(pid), win.kills),
  };
});

const cp = vi.hoisted(() => ({ execFile: vi.fn(), execFileSync: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFile: (file: string, args: string[], opts: unknown, cb: (e: null, o: string, s: string) => void) => {
    cp.execFile(file, args, opts);
    cb(null, "ok", "");
    return { stdin: null };
  },
  execFileSync: cp.execFileSync,
}));

const { whichBin, runCli } = await import("./cli-exec");
const { executableFor } = await import("./cli-path");
const { endGroup, groups, killGroup } = await import("./cli-process");

beforeEach(() => {
  win.found = "C:\\npm\\codex.cmd";
  win.killed = [];
  win.kills = true;
  cp.execFile.mockClear();
  cp.execFileSync.mockClear();
});

describe("whichBin on Windows", () => {
  it("walks PATH instead of running /usr/bin/which", () => {
    expect(whichBin("gog")).toBe("C:\\npm\\codex.cmd");
    expect(cp.execFileSync).not.toHaveBeenCalled();
  });
});

describe("runCli on Windows", () => {
  it("runs a .cmd shim through cmd.exe with a verbatim command line", async () => {
    await runCli("C:\\tc\\gog.cmd", ["auth", "list"], { env: { ComSpec: "C:\\cmd.exe" } as unknown as NodeJS.ProcessEnv });
    const [file, args, opts] = cp.execFile.mock.calls[0] as [string, string[], unknown];
    expect(file).toBe("C:\\cmd.exe");
    expect(args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(opts).toMatchObject({ windowsVerbatimArguments: true });
  });

  it("runs an .exe as it is", async () => {
    await runCli("C:\\tc\\gog.exe", ["auth"]);
    expect(cp.execFile.mock.calls[0]![0]).toBe("C:\\tc\\gog.exe");
  });
});

describe("executableFor on Windows", () => {
  it("finds codex on PATH without /usr/bin/which", () => {
    expect(executableFor("codex")).toBe("C:\\npm\\codex.cmd");
    expect(cp.execFileSync).not.toHaveBeenCalled();
  });

  it("says the CLI isn't on PATH when the walk finds nothing", () => {
    win.found = null;
    expect(() => executableFor("goose")).toThrow("goose isn't on this app's PATH.");
  });
});

describe("killGroup on Windows", () => {
  it("ends the process tree with taskkill", () => {
    groups.add(7);
    expect(killGroup(7, "SIGTERM")).toBe(true);
    expect(win.killed).toEqual([7]);
    expect(groups.has(7)).toBe(true);
  });

  it("forgets the group once taskkill finds nothing left", () => {
    win.kills = false;
    groups.add(8);
    expect(killGroup(8, "SIGKILL")).toBe(false);
    expect(groups.has(8)).toBe(false);
  });
});

describe("executableFor's other CLIs", () => {
  it("leaves Claude Code to the SDK and looks up puku-cli by its own name", () => {
    expect(executableFor("claude")).toBeUndefined();
    win.found = "C:\\npm\\puku-cli.cmd";
    expect(executableFor("puku")).toBe("C:\\npm\\puku-cli.cmd");
  });
});

describe("endGroup on Windows", () => {
  it("kills the tree once and forgets it, so no later taskkill can hit a reused pid", () => {
    vi.useFakeTimers();
    try {
      groups.add(9);
      endGroup(9);
      expect(win.killed).toEqual([9]);
      expect(groups.has(9)).toBe(false);
      vi.advanceTimersByTime(10_000);
      expect(win.killed).toEqual([9]);
    } finally {
      vi.useRealTimers();
    }
  });
});
