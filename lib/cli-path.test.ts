import { describe, expect, it, vi } from "vitest";

// Where a thread's CLI lives on a Mac: /usr/bin/which, once per backend (lib/cli-windows.test.ts has Windows).

const which = vi.hoisted(() => vi.fn((_file: string, args: string[]) => `/opt/homebrew/bin/${args[0]}\n`));
vi.mock("node:child_process", () => ({ execFileSync: which }));
vi.mock("./win-command", () => ({ isWindows: () => false, findOnWindowsPath: vi.fn() }));
const agy = vi.hoisted(() => vi.fn((): string | null => null));
vi.mock("./antigravity-login", () => ({ antigravityBin: agy }));

const { executableFor } = await import("./cli-path");

describe("executableFor on a Mac", () => {
  it("asks /usr/bin/which once and remembers the answer", () => {
    expect(executableFor("codex")).toBe("/opt/homebrew/bin/codex");
    expect(executableFor("codex")).toBe("/opt/homebrew/bin/codex");
    expect(which).toHaveBeenCalledTimes(1);
    expect(which).toHaveBeenCalledWith("/usr/bin/which", ["codex"], { encoding: "utf8" });
  });

  it("says the CLI isn't on PATH when which finds nothing", () => {
    which.mockImplementationOnce(() => {
      throw new Error("exit 1");
    });
    expect(() => executableFor("goose")).toThrow("goose isn't on this app's PATH.");
  });

  it("finds agy on PATH or in ~/.local/bin (antigravityBin), and says so when it's in neither", () => {
    expect(() => executableFor("antigravity")).toThrow("agy isn't on this app's PATH.");
    agy.mockReturnValueOnce("/Users/me/.local/bin/agy");
    expect(executableFor("antigravity")).toBe("/Users/me/.local/bin/agy");
  });
});
