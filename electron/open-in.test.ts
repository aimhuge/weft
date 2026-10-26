import { describe, expect, it, vi } from "vitest";
import { APPS, findApp, openIn, registerOpenIn } from "./open-in.cjs";

// A Mac with these .app bundles installed, plus the project folder.
function mac(installed: string[]) {
  const have = new Set(["/p", ...installed]);
  return { exists: (p: unknown) => have.has(String(p)), home: "/Users/me", run: vi.fn(() => Promise.resolve()) };
}

describe("open in", () => {
  it("picks the first installed app in the list's order, from any app folder", () => {
    const deps = mac(["/Users/me/Applications/Zed.app", "/Applications/Visual Studio Code.app"]);
    expect(findApp(APPS.editor, deps)).toBe("Visual Studio Code");
    expect(findApp(APPS.terminal, mac(["/System/Applications/Utilities/Terminal.app"]))).toBe("Terminal");
    expect(findApp(APPS.terminal, mac([]))).toBeNull();
  });

  it("opens the folder in the app it found and says which", async () => {
    const deps = mac(["/Applications/Cursor.app"]);
    expect(await openIn("/p", "editor", deps)).toBe("Cursor");
    expect(deps.run).toHaveBeenCalledWith("Cursor", "/p");
  });

  it("does nothing for an unknown target, a relative or missing folder, or no app", async () => {
    const deps = mac(["/Applications/Cursor.app"]);
    expect(await openIn("/p", "browser", deps)).toBeNull();
    expect(await openIn("p", "editor", deps)).toBeNull();
    expect(await openIn("/gone", "editor", deps)).toBeNull();
    expect(await openIn("/p", "terminal", deps)).toBeNull();
    expect(deps.run).not.toHaveBeenCalled();
  });

  it("answers the board's shell:reveal and shell:openIn", async () => {
    const on = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = { on: (c: string, f: (...args: unknown[]) => unknown) => on.set(c, f), handle: (c: string, f: (...args: unknown[]) => unknown) => on.set(c, f) };
    const shell = { openPath: vi.fn() };
    registerOpenIn(ipcMain, { ...mac(["/Applications/Ghostty.app"]), shell });
    expect(await on.get("shell:openIn")!({}, "/p", "terminal")).toBe("Ghostty");
    on.get("shell:reveal")!({}, "/p");
    on.get("shell:reveal")!({}, "/gone");
    on.get("shell:reveal")!({}, "relative");
    expect(shell.openPath.mock.calls).toEqual([["/p"]]);
  });
});
