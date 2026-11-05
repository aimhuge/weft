import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The default `exec` in worker-paths is a promisified execFile; mocking the module keeps the clone out
// of the real filesystem while still exercising that default path. The mock carries execFile's
// util.promisify.custom, so promisify calls it the way the real one is called (file, args, options, cb).
const execFile = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { promisify } = require("node:util") as typeof import("node:util");
  const fn = vi.fn();
  Object.defineProperty(fn, promisify.custom, {
    value: (file: string, args: string[], options: unknown) =>
      new Promise((resolve, reject) => {
        fn(file, args, options, (err: Error | null, out: unknown) => (err ? reject(err) : resolve(out)));
      }),
  });
  return fn;
});
vi.mock("node:child_process", () => ({ execFile }));

import { cloneProject, materialise, repoPath, type Exec } from "./worker-paths";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-worker-paths-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("repoPath", () => {
  it("puts a plain folder name under the root", () => {
    expect(repoPath("/srv/work", "weft")).toBe(path.join("/srv/work", "weft"));
  });

  it("allows nested folders", () => {
    expect(repoPath("/srv/work", "acme/weft")).toBe(path.join("/srv/work", "acme", "weft"));
  });

  it("trims and drops empty segments", () => {
    expect(repoPath("/srv/work", "  acme//weft/ ")).toBe(path.join("/srv/work", "acme", "weft"));
  });

  it("refuses an empty folder", () => {
    expect(() => repoPath("/srv/work", "")).toThrow("isn't a project folder name on this worker");
    expect(() => repoPath("/srv/work", "   ")).toThrow("isn't a project folder name on this worker");
    expect(() => repoPath("/srv/work", "///")).toThrow("isn't a project folder name on this worker");
  });

  it("refuses a parent segment", () => {
    expect(() => repoPath("/srv/work", "..")).toThrow("isn't a project folder name on this worker");
    expect(() => repoPath("/srv/work", "acme/../..")).toThrow("isn't a project folder name on this worker");
    expect(() => repoPath("/srv/work", "../etc")).toThrow("isn't a project folder name on this worker");
  });

  it("refuses a hidden segment", () => {
    expect(() => repoPath("/srv/work", ".hidden")).toThrow("isn't a project folder name on this worker");
    expect(() => repoPath("/srv/work", "acme/.git")).toThrow("isn't a project folder name on this worker");
  });

  it("refuses a backslash", () => {
    expect(() => repoPath("/srv/work", "acme\\weft")).toThrow("isn't a project folder name on this worker");
  });

  it("names the folder it refused", () => {
    expect(() => repoPath("/srv/work", "..")).toThrow('".." isn\'t a project folder name on this worker.');
  });
});

describe("materialise", () => {
  it("uses a checkout that is already there", async () => {
    const dir = path.join(root, "weft");
    fs.mkdirSync(dir);
    const sh = vi.fn();
    expect(await materialise(dir, "https://github.com/a/b.git", sh as unknown as Exec)).toBe("present");
    expect(sh).not.toHaveBeenCalled();
  });

  it("says so when there is no checkout and no repo", async () => {
    const dir = path.join(root, "weft");
    const sh = vi.fn();
    await expect(materialise(dir, undefined, sh as unknown as Exec)).rejects.toThrow(
      "There's no weft checkout on this worker yet. Send the run with its git URL to clone it.",
    );
    expect(sh).not.toHaveBeenCalled();
  });

  it("refuses a local path", async () => {
    const sh = vi.fn();
    await expect(materialise(path.join(root, "weft"), "/local/path", sh as unknown as Exec)).rejects.toThrow(
      '"/local/path" isn\'t a git URL this worker clones (https or ssh).',
    );
    expect(sh).not.toHaveBeenCalled();
  });

  it("refuses a file:// URL", async () => {
    const sh = vi.fn();
    await expect(materialise(path.join(root, "weft"), "file:///tmp/repo", sh as unknown as Exec)).rejects.toThrow(
      "isn't a git URL this worker clones",
    );
    expect(sh).not.toHaveBeenCalled();
  });

  it("refuses a helper protocol", async () => {
    const sh = vi.fn();
    await expect(materialise(path.join(root, "weft"), "ext::sh -c whoami", sh as unknown as Exec)).rejects.toThrow(
      "isn't a git URL this worker clones",
    );
    expect(sh).not.toHaveBeenCalled();
  });

  it("clones an https URL into the folder", async () => {
    const dir = path.join(root, "weft");
    const sh = vi.fn(() => Promise.resolve({ stdout: "" }));
    expect(await materialise(dir, "https://github.com/a/b.git", sh as unknown as Exec)).toBe("cloned");
    expect(sh).toHaveBeenCalledWith("git", ["clone", "--no-checkout", "--", "https://github.com/a/b.git", expect.stringContaining(".cloning-")], {});
  });

  it("clones an ssh URL into the folder", async () => {
    const dir = path.join(root, "weft");
    const sh = vi.fn(() => Promise.resolve({ stdout: "" }));
    expect(await materialise(dir, "git@github.com:a/b.git", sh as unknown as Exec)).toBe("cloned");
    expect(sh).toHaveBeenCalledWith("git", ["clone", "--no-checkout", "--", "git@github.com:a/b.git", expect.stringContaining(".cloning-")], {});
  });

  it("clones an ssh:// URL into the folder", async () => {
    const dir = path.join(root, "weft");
    const sh = vi.fn(() => Promise.resolve({ stdout: "" }));
    expect(await materialise(dir, "ssh://git@github.com/a/b.git", sh as unknown as Exec)).toBe("cloned");
    expect(sh).toHaveBeenCalledWith("git", ["clone", "--no-checkout", "--", "ssh://git@github.com/a/b.git", expect.stringContaining(".cloning-")], {});
  });

  it("makes the parent folder before it clones", async () => {
    const dir = path.join(root, "nested", "weft");
    const sh = vi.fn<Exec>(() => Promise.resolve({ stdout: "" }));
    await materialise(dir, "https://github.com/a/b.git", sh);
    expect(fs.existsSync(path.dirname(dir))).toBe(true);
  });

  it("lets a failed clone throw", async () => {
    const dir = path.join(root, "weft");
    const sh = vi.fn(() => Promise.reject(new Error("no network")));
    await expect(materialise(dir, "https://github.com/a/b.git", sh as unknown as Exec)).rejects.toThrow("no network");
  });

  it("clones beside the folder, and only then moves it into place", async () => {
    const dir = path.join(root, "weft");
    const seen: boolean[] = [];
    const sh = vi.fn<Exec>(() => {
      seen.push(fs.existsSync(dir));
      return Promise.resolve({ stdout: "" });
    });
    await materialise(dir, "https://github.com/a/b.git", sh);
    expect(seen).not.toContain(true);
    expect(fs.readdirSync(root)).toEqual(["weft"]);
  });

  it("takes the checkout another clone finished first", async () => {
    const dir = path.join(root, "weft");
    const sh = vi.fn<Exec>(() => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "theirs"), "");
      return Promise.resolve({ stdout: "" });
    });
    expect(await materialise(dir, "https://github.com/a/b.git", sh)).toBe("present");
    expect(fs.readdirSync(root)).toEqual(["weft"]);
    expect(fs.readdirSync(dir)).toEqual(["theirs"]);
  });

  it("clears a temp folder a dead worker left, and keeps a live one", async () => {
    const stale = path.join(root, ".cloning-stale");
    const live = path.join(root, ".cloning-live");
    fs.mkdirSync(stale);
    fs.mkdirSync(live);
    fs.mkdirSync(path.join(root, "other"));
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000);
    fs.utimesSync(stale, twoHoursAgo, twoHoursAgo);
    await materialise(path.join(root, "weft"), "https://github.com/a/b.git", vi.fn<Exec>(() => Promise.resolve({ stdout: "" })));
    expect(fs.readdirSync(root).sort()).toEqual([".cloning-live", "other", "weft"]);
  });

  it("clones with the real git when no exec is injected", async () => {
    execFile.mockReset();
    execFile.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: (e: unknown, out: unknown) => void) =>
      cb(null, { stdout: "", stderr: "" }),
    );
    const dir = path.join(root, "weft");
    expect(await materialise(dir, "https://github.com/a/b.git")).toBe("cloned");
    expect(execFile).toHaveBeenCalledWith(
      "git",
      ["clone", "--no-checkout", "--", "https://github.com/a/b.git", expect.stringContaining(".cloning-")],
      expect.objectContaining({ timeout: 600_000 }),
      expect.any(Function),
    );
  });

  it("throws when the real clone fails", async () => {
    execFile.mockReset();
    execFile.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: (e: unknown, out: unknown) => void) =>
      cb(new Error("fatal: repository not found"), { stdout: "", stderr: "" }),
    );
    const dir = path.join(root, "weft");
    await expect(materialise(dir, "https://github.com/a/b.git")).rejects.toThrow("fatal: repository not found");
  });
});

describe("cloneProject", () => {
  const origin = (url: string) => vi.fn<Exec>(() => Promise.resolve({ stdout: `${url}\n` }));

  it("clones a missing folder", async () => {
    const dir = path.join(root, "weft");
    const sh = vi.fn<Exec>(() => Promise.resolve({ stdout: "" }));
    expect(await cloneProject(dir, "https://github.com/a/weft.git", sh)).toBe("cloned");
    expect(sh).not.toHaveBeenCalledWith("git", ["-C", dir, "remote", "get-url", "origin"], {});
  });

  it("is happy with the same repo, in https or ssh form", async () => {
    const dir = path.join(root, "weft");
    fs.mkdirSync(dir);
    expect(await cloneProject(dir, "https://github.com/a/weft.git", origin("https://github.com/a/weft"))).toBe("present");
    expect(await cloneProject(dir, "https://github.com/A/weft.git", origin("git@github.com:a/weft.git"))).toBe("present");
    expect(await cloneProject(dir, "https://github.com/a/weft.git", origin("ssh://git@github.com/a/weft.git/"))).toBe("present");
  });

  it("refuses a folder holding another owner's repo", async () => {
    const dir = path.join(root, "weft");
    fs.mkdirSync(dir);
    await expect(cloneProject(dir, "https://github.com/a/weft.git", origin("https://github.com/b/weft.git"))).rejects.toThrow(
      "There's already a different weft on this worker (https://github.com/b/weft.git).",
    );
  });

  it("refuses a folder that is no clone at all", async () => {
    const dir = path.join(root, "weft");
    fs.mkdirSync(dir);
    const sh = vi.fn<Exec>(() => Promise.reject(new Error("not a git repository")));
    await expect(cloneProject(dir, "https://github.com/a/weft.git", sh)).rejects.toThrow("There's already a different weft on this worker.");
    const silent = vi.fn<Exec>(() => Promise.resolve({}));
    await expect(cloneProject(dir, "https://github.com/a/weft.git", silent)).rejects.toThrow("There's already a different weft on this worker.");
  });

  it("uses the real git when no exec is injected, and stops it asking", async () => {
    execFile.mockReset();
    execFile.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: (e: unknown, out: unknown) => void) => cb(null, { stdout: "", stderr: "" }));
    expect(await cloneProject(path.join(root, "weft"), "https://github.com/a/weft.git")).toBe("cloned");
    const opts = execFile.mock.calls[0]?.[2] as { env: NodeJS.ProcessEnv };
    expect(opts.env.GIT_TERMINAL_PROMPT).toBe("0");
  });
});
