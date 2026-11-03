// The worker's file watcher for live reload (lib/worker-file-watch.ts) over a real folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchCardFiles } from "./worker-file-watch";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-watch-"));
  fs.writeFileSync(path.join(dir, "a.ts"), "one");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("watchCardFiles", () => {
  it("calls back with the new hash after a change, null once the file is gone, and nothing after stop", async () => {
    let cwd: string | undefined = dir;
    const changed = vi.fn();
    const stop = watchCardFiles(() => cwd, 20)("c1", "a.ts", changed);
    await new Promise((done) => setTimeout(done, 60));
    fs.writeFileSync(path.join(dir, "a.ts"), "two, longer");
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{40}$/)), { timeout: 3_000 });
    fs.rmSync(path.join(dir, "a.ts"));
    await vi.waitFor(() => expect(changed).toHaveBeenLastCalledWith(null), { timeout: 3_000 });
    // The card went: a change reads as null.
    cwd = undefined;
    fs.writeFileSync(path.join(dir, "a.ts"), "three");
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(3), { timeout: 3_000 });
    expect(changed).toHaveBeenLastCalledWith(null);
    stop();
    const calls = changed.mock.calls.length;
    fs.writeFileSync(path.join(dir, "a.ts"), "four, after the stop");
    await new Promise((done) => setTimeout(done, 100));
    expect(changed).toHaveBeenCalledTimes(calls);
  });

  it("reads a refused path as null, and watches nothing for a card that isn't here", async () => {
    fs.writeFileSync(path.join(dir, "x.bin"), Buffer.from([0, 1, 2, 0, 255]));
    const changed = vi.fn();
    const stop = watchCardFiles(() => dir, 20)("c1", "x.bin", changed);
    await new Promise((done) => setTimeout(done, 60));
    fs.writeFileSync(path.join(dir, "x.bin"), Buffer.from([0, 1, 2, 0, 255, 0, 9]));
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(null), { timeout: 3_000 });
    stop();
    expect(() => watchCardFiles(() => undefined)("c1", "a.ts", changed)()).not.toThrow();
  });
});
