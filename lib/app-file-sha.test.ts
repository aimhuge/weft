// lib/app-file-sha.ts: a file's sha256, remembered by its path, size and mtime. The preview timer asks
// the same question every few minutes, so an unchanged file isn't read and hashed again.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sha256Cached, forgetSha } = await import("./app-file-sha");
const { sha256Of } = await import("./blob-store");

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-file-sha-"));
  delete (globalThis as unknown as Record<string, unknown>).__weftFileSha;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("sha256Cached", () => {
  it("gives the same sha as hashing the file", async () => {
    const file = path.join(dir, "a.txt");
    fs.writeFileSync(file, "hello");
    expect(await sha256Cached(file)).toBe(await sha256Of(file));
  });

  it("doesn't read the file again when it hasn't changed", async () => {
    const file = path.join(dir, "a.txt");
    fs.writeFileSync(file, "hello");
    const first = await sha256Cached(file);

    const spy = vi.spyOn(fs, "createReadStream");
    const second = await sha256Cached(file);
    expect(second).toBe(first);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("hashes it again when the contents change", async () => {
    const file = path.join(dir, "a.txt");
    fs.writeFileSync(file, "hello");
    const first = await sha256Cached(file);
    // A different size, so the cache knows it's stale.
    fs.writeFileSync(file, "hello there");
    const second = await sha256Cached(file);
    expect(second).not.toBe(first);
    expect(second).toBe(await sha256Of(file));
  });

  it("hashes it again when only the mtime moved", async () => {
    const file = path.join(dir, "a.txt");
    fs.writeFileSync(file, "hello");
    const first = await sha256Cached(file);
    // The same bytes, but a new mtime: the cache can't know, so it reads the file.
    const later = new Date(Date.now() + 10_000);
    fs.utimesSync(file, later, later);
    const second = await sha256Cached(file);
    expect(second).toBe(first);
  });

  it("has nothing for a file that isn't there", async () => {
    expect(await sha256Cached(path.join(dir, "gone.txt"))).toBeNull();
  });

  it("has nothing for a directory", async () => {
    expect(await sha256Cached(dir)).toBeNull();
  });

  it("has nothing when the file goes away between the stat and the hash", async () => {
    const file = path.join(dir, "gone.txt");
    fs.writeFileSync(file, "hello");
    // The file is there for the stat, and gone by the time it's hashed.
    const stat = vi.spyOn(fs, "statSync");
    stat.mockImplementationOnce(((p: string) => {
      if (p === file) {
        fs.rmSync(file);
        return { size: 5, mtimeMs: 1, isFile: () => true };
      }
      return fs.statSync(p);
    }) as never);
    expect(await sha256Cached(file)).toBeNull();
    stat.mockRestore();
  });
});

describe("forgetSha", () => {
  it("makes the next call hash the file again", async () => {
    const file = path.join(dir, "a.txt");
    fs.writeFileSync(file, "hello");
    await sha256Cached(file);
    forgetSha(file);
    const spy = vi.spyOn(fs, "createReadStream");
    await sha256Cached(file);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
