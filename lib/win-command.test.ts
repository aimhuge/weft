import { describe, expect, it, vi } from "vitest";
import { findOnWindowsPath, isWindows, killTree, quoteCmdArg, shellPlan, spawnPlan } from "./win-command";

// Windows' lookups and command lines, checked from any OS: every function takes the platform, PATH and
// filesystem it works against.

describe("isWindows", () => {
  it("is true for win32 only", () => {
    expect(isWindows("win32")).toBe(true);
    expect(isWindows("darwin")).toBe(false);
    expect(typeof isWindows()).toBe("boolean");
  });
});

describe("findOnWindowsPath", () => {
  const files = new Set(["C:\\npm\\codex.cmd", "C:\\tools\\codex.exe", "C:\\bin\\gog.exe"]);
  const exists = (file: string) => files.has(file);

  it("walks PATH in order, trying each PATHEXT extension", () => {
    const env = { Path: "C:\\nothing;C:\\npm;C:\\tools", PATHEXT: ".EXE;.CMD" };
    expect(findOnWindowsPath("codex", { env, exists })).toBe("C:\\npm\\codex.cmd");
  });

  it("prefers an .exe over a .cmd in the same folder, as PATHEXT orders them", () => {
    const both = new Set(["C:\\x\\codex.exe", "C:\\x\\codex.cmd"]);
    expect(findOnWindowsPath("codex", { env: { PATH: "C:\\x" }, exists: (f) => both.has(f) })).toBe("C:\\x\\codex.exe");
  });

  it("takes a name that already has an extension as it is, and strips quotes from PATH entries", () => {
    expect(findOnWindowsPath("gog.exe", { env: { PATH: '"C:\\bin"' }, exists })).toBe("C:\\bin\\gog.exe");
  });

  it("is null when nothing matches or PATH is missing", () => {
    expect(findOnWindowsPath("missing", { env: { PATH: "C:\\npm" }, exists })).toBeNull();
    expect(findOnWindowsPath("codex", { env: {}, exists })).toBeNull();
  });

  it("checks the real filesystem by default", () => {
    expect(findOnWindowsPath("definitely-not-a-weft-command", { env: { PATH: "C:\\none" } })).toBeNull();
  });
});

describe("quoteCmdArg", () => {
  it("quotes an argument and escapes cmd's metacharacters", () => {
    expect(quoteCmdArg("plain")).toBe('^"plain^"');
    expect(quoteCmdArg("a b&c")).toBe('^"a^ b^&c^"');
  });

  it("escapes embedded quotes and doubles the backslashes before them and at the end", () => {
    expect(quoteCmdArg('say "hi"')).toBe('^"say^ \\^"hi\\^"^"');
    expect(quoteCmdArg("C:\\dir\\")).toBe('^"C:\\dir\\\\^"');
  });
});

describe("spawnPlan", () => {
  it("leaves a command alone off Windows, or when it isn't a shim", () => {
    expect(spawnPlan("/usr/bin/codex", ["exec"], { platform: "darwin" })).toEqual({ command: "/usr/bin/codex", args: ["exec"] });
    expect(spawnPlan("C:\\x\\codex.exe", ["exec"], { platform: "win32" })).toEqual({ command: "C:\\x\\codex.exe", args: ["exec"] });
  });

  it("runs a .cmd or .bat shim through cmd.exe with a verbatim, escaped command line", () => {
    const plan = spawnPlan("C:\\npm\\codex.cmd", ["exec", "--json"], { platform: "win32", env: { ComSpec: "C:\\Windows\\cmd.exe" } });
    expect(plan).toEqual({
      command: "C:\\Windows\\cmd.exe",
      args: ["/d", "/s", "/c", '"C:\\npm\\codex.cmd ^"exec^" ^"--json^""'],
      windowsVerbatimArguments: true,
    });
    expect(spawnPlan("run.BAT", [], { platform: "win32", env: {} }).command).toBe("cmd.exe");
    expect(spawnPlan("run.cmd", []).command).toBe(process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "run.cmd");
  });
});

describe("shellPlan", () => {
  it("is $SHELL -c, or zsh, off Windows", () => {
    expect(shellPlan("ls", { platform: "darwin", env: { SHELL: "/bin/bash" } })).toEqual({ command: "/bin/bash", args: ["-c", "ls"] });
    expect(shellPlan("ls", { platform: "linux", env: {} }).command).toBe("/bin/zsh");
    expect(shellPlan("ls").args).toContain(process.platform === "win32" ? '"ls"' : "ls");
  });

  it("is cmd.exe /d /s /c on Windows", () => {
    expect(shellPlan("dir & echo hi", { platform: "win32", env: { COMSPEC: "C:\\cmd.exe" } })).toEqual({
      command: "C:\\cmd.exe",
      args: ["/d", "/s", "/c", '"dir & echo hi"'],
      windowsVerbatimArguments: true,
    });
    expect(shellPlan("dir", { platform: "win32", env: {} }).command).toBe("cmd.exe");
  });
});

describe("killTree", () => {
  it("ends the tree with taskkill /T /F", () => {
    const run = vi.fn();
    expect(killTree(42, run as never)).toBe(true);
    expect(run).toHaveBeenCalledWith("taskkill", ["/pid", "42", "/T", "/F"], { stdio: "ignore", windowsHide: true });
  });

  it("is false when taskkill fails (nothing left to end)", () => {
    const fails = () => {
      throw new Error("not found");
    };
    expect(killTree(42, fails)).toBe(false);
  });

  it("runs the real taskkill by default, which fails off Windows", () => {
    if (process.platform !== "win32") expect(killTree(2 ** 22)).toBe(false);
  });
});
