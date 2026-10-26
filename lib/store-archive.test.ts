import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

// store.ts reads WEFT_DATA once at import, so each test points it at a fresh temp dir and re-imports it.
let dir: string;
const g = globalThis as unknown as { __weftState?: unknown };

async function load() {
  vi.resetModules();
  delete g.__weftState;
  return import("./store");
}

const input = { title: "t", prompt: "p", cwd: "/tmp", backend: "claude" } as Parameters<Awaited<ReturnType<typeof load>>["createCard"]>[0];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-store-archive-"));
  process.env.WEFT_DATA = dir;
});
afterEach(() => {
  delete g.__weftState;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("updateCard and archived", () => {
  it("a card moved out of Done is no longer archived, unless the move archives it itself", async () => {
    const store = await load();
    store.createCard(input, "a");
    // Moved to Done from the commit walk-through and filed away, then its session closed with a question
    // still pending (lib/runner-session.ts): it lands in Review and must show on the board.
    store.updateCard("a", { column: "done", pending: { id: "1" } as Card["pending"] });
    store.updateCard("a", { archived: true });
    expect(store.updateCard("a", { column: "review", pending: null }).archived).toBeUndefined();
    // Archived outside Done by your own hand (E, a Backlog lane) stays archived.
    expect(store.updateCard("a", { archived: true }).archived).toBe(true);
    expect(store.updateCard("a", { title: "t2" }).archived).toBe(true);
    expect(store.updateCard("a", { column: "backlog", archived: true }).archived).toBe(true);
    // Into Done, archived stays as it was: archiveWhenIdle decides it.
    expect(store.updateCard("a", { column: "done" }).archived).toBe(true);
  });
});
