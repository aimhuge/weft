import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// store.ts reads WEFT_DATA once at import, so each test points it at a fresh temp dir and re-imports it.
let dir: string;
const g = globalThis as unknown as { __weftState?: unknown };

async function load() {
  vi.resetModules();
  delete g.__weftState;
  return import("./store");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-store-drop-"));
  process.env.WEFT_DATA = dir;
});
afterEach(() => {
  delete g.__weftState;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("dropThreadFrom", () => {
  it("drops the end of the thread and tells the board, clearing it when nothing is left", async () => {
    const store = await load();
    const { subscribe } = await import("./bus");
    const seen: unknown[] = [];
    const off = subscribe((e) => seen.push(e));
    store.appendThread("c", { kind: "user", text: "one", at: 1 });
    store.appendThread("c", { kind: "user", text: "check-in", at: 2 });
    store.appendThread("c", { kind: "assistant", text: "QUIET", at: 3 });
    seen.length = 0;
    store.dropThreadFrom("c", 1);
    expect(store.getThread("c")).toEqual([{ kind: "user", text: "one", at: 1 }]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "threads", "c.json"), "utf8"))).toHaveLength(1);
    expect(seen).toContainEqual({ type: "thread", cardId: "c", item: { kind: "user", text: "one", at: 1 }, index: 0, truncate: true });
    store.dropThreadFrom("c", 0);
    off();
    expect(store.getThread("c")).toEqual([]);
    expect(seen).toContainEqual({ type: "thread_cleared", cardId: "c" });
  });

});
