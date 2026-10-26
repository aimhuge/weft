import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileAtomic } from "./atomic-write";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-write-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("writes a new file and replaces an old one, leaving no temp file behind", () => {
    const file = path.join(dir, "board.json");
    writeFileAtomic(file, "one");
    expect(fs.readFileSync(file, "utf8")).toBe("one");
    writeFileAtomic(file, "two");
    expect(fs.readFileSync(file, "utf8")).toBe("two");
    expect(fs.readdirSync(dir)).toEqual(["board.json"]);
  });

  it("fsyncs the temp file before the rename", () => {
    const order: string[] = [];
    const fsync = fs.fsyncSync;
    vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      order.push("fsync");
      fsync(fd);
    });
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((a, b) => {
      order.push("rename");
      rename(a, b);
    });
    writeFileAtomic(path.join(dir, "board.json"), "x");
    // The data's fsync, the rename, then the folder's fsync.
    expect(order).toEqual(["fsync", "rename", "fsync"]);
  });

  it("keeps the old file whole and removes the temp file when the write fails", () => {
    const file = path.join(dir, "board.json");
    writeFileAtomic(file, "old");
    vi.spyOn(fs, "fsyncSync").mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    expect(() => writeFileAtomic(file, "new")).toThrow("disk full");
    expect(fs.readFileSync(file, "utf8")).toBe("old");
    expect(fs.readdirSync(dir)).toEqual(["board.json"]);
  });

  it("still succeeds when the folder can't be fsynced", () => {
    const file = path.join(dir, "board.json");
    const fsync = fs.fsyncSync;
    let calls = 0;
    vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      if (++calls === 2) throw new Error("EINVAL");
      fsync(fd);
    });
    writeFileAtomic(file, "ok");
    expect(fs.readFileSync(file, "utf8")).toBe("ok");
  });
});
