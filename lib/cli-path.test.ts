import { describe, expect, it, vi } from "vitest";

// Where a thread's CLI lives on a Mac: /usr/bin/which, once per backend (lib/cli-windows.test.ts has Windows).

const which = vi.hoisted(() => vi.fn((_file: string, args: string[]) => `/opt/homebrew/bin/${args[0]}\n`));
vi.mock("node:child_process", () => ({ execFileSync: which }));
vi.mock("./win-command", () => ({ isWindows: () => false, findOnWindowsPath: vi.fn() }));

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
});
