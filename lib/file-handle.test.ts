// The editor's race-checked I/O (lib/file-handle.ts): a read holds the file it checked, a save lands only in the parent
// it checked, and anything that moved out of the folder in between is refused.
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handlePath, openInside, within, writeInside } from "./file-handle";

let root: string;
let outside: string;
const escaped = () => new Error("escaped");

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-handle-")));
  outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-handle-out-")));
  fs.writeFileSync(path.join(root, "a.ts"), "a");
  fs.writeFileSync(path.join(outside, "secret.txt"), "s");
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe("within", () => {
  it("is the folder and what's under it", () => {
    expect(within("/r", "/r")).toBe(true);
    expect(within("/r", "/r/a/b")).toBe(true);
    expect(within("/r", "/rx")).toBe(false);
    expect(within("/r", "/")).toBe(false);
  });
});

describe("handlePath", () => {
  it("reads /proc's link where there is one, and is null where there isn't", async () => {
    await expect(handlePath(7, (p) => Promise.resolve(`held ${p}`))).resolves.toBe("held /proc/self/fd/7");
    await expect(handlePath(7, () => Promise.reject(new Error("ENOENT")))).resolves.toBeNull();
  });
});

describe("openInside", () => {
  it("opens a file inside the folder", async () => {
    const fh = await openInside(path.join(root, "a.ts"), root, escaped);
    expect(await fh.readFile("utf8")).toBe("a");
    await fh.close();
  });

  it("refuses a file outside, and won't follow a symlink at the end", async () => {
    await expect(openInside(path.join(outside, "secret.txt"), root, escaped)).rejects.toThrow("escaped");
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "link.txt"));
    await expect(openInside(path.join(root, "link.txt"), root, escaped)).rejects.toThrow();
  });

  it("refuses when the name now points at another file than the one it opened", async () => {
    const real = fsp.stat;
    vi.spyOn(fsp, "stat").mockImplementation(async (p) => Object.assign(await real(p), { ino: -1 }));
    await expect(openInside(path.join(root, "a.ts"), root, escaped)).rejects.toThrow("escaped");
  });
});

describe("writeInside", () => {
  it("saves atomically in the real parent, making folders it needs", async () => {
    const target = await writeInside(path.join(root, "src", "b.ts"), root, "b", escaped);
    expect(target).toBe(path.join(root, "src", "b.ts"));
    expect(fs.readFileSync(target, "utf8")).toBe("b");
    expect(fs.readdirSync(path.join(root, "src"))).toEqual(["b.ts"]);
  });

  it("refuses a parent outside the folder", async () => {
    fs.symlinkSync(outside, path.join(root, "out"));
    await expect(writeInside(path.join(root, "out", "c.txt"), root, "c", escaped)).rejects.toThrow("escaped");
    expect(fs.existsSync(path.join(outside, "c.txt"))).toBe(false);
  });

  it("refuses when the parent moved between the temp file and the rename, and leaves no temp behind", async () => {
    const real = fsp.realpath;
    let calls = 0;
    vi.spyOn(fsp, "realpath").mockImplementation((p) => (++calls === 2 ? Promise.resolve(outside) : real(p)));
    await expect(writeInside(path.join(root, "d.ts"), root, "d", escaped)).rejects.toThrow("escaped");
    expect(fs.readdirSync(root)).toEqual(["a.ts"]);
  });
});
