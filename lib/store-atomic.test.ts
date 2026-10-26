// board.json is written atomically (lib/atomic-write.ts): a temp file renamed over it, so a crash mid-write can't
// leave a half-written board. Beside the other store tests in lib/store*.test.ts, to keep store.test.ts under its cap.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

let dir: string;
const g = globalThis as unknown as { __weftState?: unknown };

async function load() {
  vi.resetModules();
  delete g.__weftState;
  return import("./store");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-store-"));
  process.env.WEFT_DATA = dir;
});
afterEach(() => {
  vi.restoreAllMocks();
  delete g.__weftState;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("saving board.json", () => {
  it("renames a temp file over it and leaves none behind", async () => {
    const store = await load();
    const rename = vi.spyOn(fs, "renameSync");
    store.createCard({ title: "t", prompt: "p", cwd: "/tmp", backend: "claude" } as Parameters<typeof store.createCard>[0], "c");
    const save = rename.mock.calls.find(([, to]) => String(to) === path.join(dir, "board.json"));
    expect(String(save?.[0])).toMatch(/\.board\.json\.\d+\.tmp$/);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "board.json"), "utf8")) as { cards: Card[] };
    expect(saved.cards.map((c) => c.id)).toEqual(["c"]);
  });

  it("keeps the last good board when a save fails", async () => {
    const store = await load();
    const input = { title: "t", prompt: "p", cwd: "/tmp", backend: "claude" } as Parameters<typeof store.createCard>[0];
    store.createCard(input, "a");
    vi.spyOn(fs, "fsyncSync").mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    expect(() => store.createCard(input, "b")).toThrow("disk full");
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "board.json"), "utf8")) as { cards: Card[] };
    expect(saved.cards.map((c) => c.id)).toEqual(["a"]);
  });
});
