import fs from "node:fs";
import os from "node:os";
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

const { SHOW_DIR, scratchDirs, sessionDirs } = await import("./show-dir");
const temps = [...new Set(["/tmp", fs.realpathSync("/tmp"), os.tmpdir(), fs.realpathSync(os.tmpdir())])];

// Every session's CLI gets SHOW_DIR as a working directory, so writing its own pane page never asks (2026-10-31).
describe("sessionDirs", () => {
  it("puts the show folder in the data dir", () => {
    expect(SHOW_DIR).toBe(path.join(h.data, "show"));
  });

  it("gives a session with no grants the show folder and the temp dirs, the show folder made first so the CLI keeps it", () => {
    const dirs = sessionDirs(undefined);
    const show = fs.realpathSync(SHOW_DIR);
    expect(dirs).toEqual([...new Set([SHOW_DIR, show, ...temps])]);
    expect(fs.statSync(SHOW_DIR).isDirectory()).toBe(true);
    expect(sessionDirs([])).toEqual(dirs);
  });

  it("keeps the card's grants and adds each scratch folder once", () => {
    const scratch = scratchDirs();
    expect(sessionDirs(["/Users/dev/deckcp"])).toEqual(["/Users/dev/deckcp", ...scratch]);
    expect(sessionDirs([SHOW_DIR, "/x"])).toEqual([SHOW_DIR, "/x", ...scratch.slice(1)]);
  });

  it("still names the folder when it can't be made", () => {
    fs.rmSync(SHOW_DIR, { recursive: true, force: true });
    vi.mocked(fs.mkdirSync).mockImplementationOnce(() => {
      throw new Error("EACCES");
    });
    expect(sessionDirs(undefined)).toEqual([SHOW_DIR, ...temps]);
  });
});

// macOS's tmpdir is /var/folders/…/T while threads mostly use /tmp, which is /private/tmp: both, by their real paths (2026-11-02).
describe("scratchDirs", () => {
  it("names /tmp and the system tmpdir as written and resolved, once each", () => {
    expect(scratchDirs().filter((d) => !d.includes("weft-show-dir-"))).toEqual(temps);
    expect(scratchDirs()).toContain("/private/tmp");
  });
});
