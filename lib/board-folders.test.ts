// The folders the board's header works in (lib/board-folders.ts): the badges read a worker's project too, the
// terminal and the sync menu only this Mac's.
import { describe, expect, it, vi } from "vitest";
import { projectFolders } from "./board-folders";

describe("projectFolders", () => {
  it("is this Mac's folder for all three on a local project", () => {
    expect(projectFolders("/Users/me/dev/weft", "/Users/me")).toEqual({ folder: "/Users/me/dev/weft", reads: "/Users/me/dev/weft", terminalCwd: "/Users/me/dev/weft" });
  });

  it("reads a worker's project, while the terminal stays home", () => {
    expect(projectFolders("worker://w1/ling", "/Users/me")).toEqual({ folder: null, reads: "worker://w1/ling", terminalCwd: "/Users/me" });
  });

  it("opens the terminal on a worker's project where this Mac can sign for it (over the worker's line)", () => {
    vi.stubGlobal("window", { weft: { approval: { widen: vi.fn() } } });
    try {
      expect(projectFolders("worker://w1/ling", "/Users/me").terminalCwd).toBe("worker://w1/ling");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("has nothing to read with no project", () => {
    expect(projectFolders(undefined, "/Users/me")).toEqual({ folder: null, reads: null, terminalCwd: "/Users/me" });
  });
});
