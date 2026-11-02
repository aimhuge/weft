import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ data: "" }));
vi.mock("./store", async () => {
  const [fs, os, path] = await Promise.all([import("node:fs"), import("node:os"), import("node:path")]);
  h.data = fs.mkdtempSync(path.join(os.tmpdir(), "weft-show-dir-"));
  return { DATA_DIR: h.data };
});
vi.mock("node:fs", async (real) => {
  const mod = await real<typeof import("node:fs")>();
  const mkdirSync = vi.fn(mod.mkdirSync);
  return { ...mod, default: { ...mod, mkdirSync }, mkdirSync };
});

const { SHOW_DIR, sessionDirs } = await import("./show-dir");

// Every session's CLI gets SHOW_DIR as a working directory, so writing its own pane page never asks (2026-10-31).
describe("sessionDirs", () => {
  it("puts the show folder in the data dir", () => {
    expect(SHOW_DIR).toBe(path.join(h.data, "show"));
  });

  it("gives a session with no grants the show folder alone, made first so the CLI keeps it", () => {
    expect(sessionDirs(undefined)).toEqual([SHOW_DIR]);
    expect(fs.statSync(SHOW_DIR).isDirectory()).toBe(true);
    expect(sessionDirs([])).toEqual([SHOW_DIR]);
  });

  it("keeps the card's grants and adds the show folder once", () => {
    expect(sessionDirs(["/Users/dev/deckcp"])).toEqual(["/Users/dev/deckcp", SHOW_DIR]);
    expect(sessionDirs([SHOW_DIR, "/x"])).toEqual([SHOW_DIR, "/x"]);
  });

  it("still names the folder when it can't be made", () => {
    vi.mocked(fs.mkdirSync).mockImplementationOnce(() => {
      throw new Error("EACCES");
    });
    expect(sessionDirs(undefined)).toEqual([SHOW_DIR]);
  });
});
