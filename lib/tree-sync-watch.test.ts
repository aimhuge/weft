// A synced folder's watcher (lib/tree-sync-watch.ts): batched, normalised, and deaf to .git and its own temp files.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BATCH_MS, watchFolder } from "./tree-sync-watch";

type Fn = (event: string, file: string | Buffer | null) => void;

function fakeWatch(withOn = true) {
  let fire: Fn = () => {};
  const watcher = { close: vi.fn(), ...(withOn ? { on: vi.fn() } : {}) };
  const watch = vi.fn((_dir: string, _opts: { recursive: true }, fn: Fn) => {
    fire = fn;
    return watcher;
  });
  return { watch, watcher, fire: (f: string | Buffer | null) => fire("change", f) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("watchFolder", () => {
  it("watches the folder recursively and batches changes into one call", () => {
    const w = fakeWatch();
    const onPaths = vi.fn();
    watchFolder("/repo", onPaths, w.watch);
    expect(w.watch).toHaveBeenCalledWith("/repo", { recursive: true }, expect.any(Function));
    w.fire("a.ts");
    w.fire("src/b.ts");
    w.fire("a.ts");
    vi.advanceTimersByTime(BATCH_MS - 1);
    expect(onPaths).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onPaths).toHaveBeenCalledTimes(1);
    expect(onPaths).toHaveBeenCalledWith(["a.ts", "src/b.ts"]);
    w.fire("c.ts");
    vi.advanceTimersByTime(BATCH_MS);
    expect(onPaths).toHaveBeenLastCalledWith(["c.ts"]);
  });

  it("drops .git, .git/ paths, its own temp files and null names; keeps look-alikes", () => {
    const w = fakeWatch();
    const onPaths = vi.fn();
    watchFolder("/repo", onPaths, w.watch, 10);
    for (const f of [null, "", ".git", ".git/index", ".weft-sync-abc123", "src/.weft-sync-0f"]) w.fire(f);
    vi.advanceTimersByTime(10);
    expect(onPaths).not.toHaveBeenCalled();
    for (const f of [".github/x.yml", ".gitignore", "src/.weft-sync-xyz", ".weft-sync-ab.txt"]) w.fire(f);
    vi.advanceTimersByTime(10);
    expect(onPaths).toHaveBeenCalledWith([".github/x.yml", ".gitignore", "src/.weft-sync-xyz", ".weft-sync-ab.txt"]);
  });

  it("normalises backslash paths and takes Buffer names", () => {
    const w = fakeWatch();
    const onPaths = vi.fn();
    watchFolder("/repo", onPaths, w.watch, 10);
    w.fire("src\\lib\\a.ts");
    w.fire(Buffer.from("b.ts"));
    w.fire(".git\\HEAD");
    vi.advanceTimersByTime(10);
    expect(onPaths).toHaveBeenCalledWith(["src/lib/a.ts", "b.ts"]);
  });

  it("swallows watcher errors, and works on a watcher without on()", () => {
    const w = fakeWatch();
    watchFolder("/repo", vi.fn(), w.watch);
    expect(w.watcher.on).toHaveBeenCalledWith("error", expect.any(Function));
    const handler = (w.watcher.on as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as (e: Error) => void;
    expect(() => handler(new Error("gone"))).not.toThrow();
    const bare = fakeWatch(false);
    expect(() => watchFolder("/repo", vi.fn(), bare.watch)).not.toThrow();
  });

  it("close clears a pending batch and closes the watcher", () => {
    const w = fakeWatch();
    const onPaths = vi.fn();
    const close = watchFolder("/repo", onPaths, w.watch);
    w.fire("a.ts");
    close();
    vi.advanceTimersByTime(BATCH_MS * 2);
    expect(onPaths).not.toHaveBeenCalled();
    expect(w.watcher.close).toHaveBeenCalledTimes(1);
  });

  it("defaults to node's fs.watch", async () => {
    vi.useRealTimers();
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tree-watch-"));
    const close = watchFolder(dir, vi.fn());
    close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
