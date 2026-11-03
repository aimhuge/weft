// thread.page, thread.search and thread.tool against a real store in a temp folder: a page, the whole thread, a find,
// a trimmed tool result fetched whole, and the 404s a route maps.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadItem } from "../types";

const loadTranscript = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("../import", () => ({ loadTranscript }));

let dir: string;
const g = globalThis as unknown as { __weftState?: unknown };

async function load() {
  vi.resetModules();
  delete g.__weftState;
  const store = await import("../store");
  const verbs = await import("./thread");
  const { NotFound } = await import("./types");
  return { store, NotFound, ...verbs };
}

const LONG = "x".repeat(50_000);
const items: ThreadItem[] = [
  { kind: "user", text: "find the needle", at: 1 },
  { kind: "tool", id: "t1", name: "Bash", summary: "ls", result: LONG, at: 2 },
  { kind: "assistant", text: "done", at: 3 },
];

async function seeded() {
  const s = await load();
  s.store.createCard({ title: "t", prompt: "p", cwd: dir, backend: "claude", permissionMode: "default" }, "c1");
  items.forEach((item) => s.store.appendThread("c1", item));
  return s;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-thread-verbs-"));
  process.env.WEFT_DATA = dir;
  loadTranscript.mockClear();
});
afterEach(() => {
  delete g.__weftState;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("thread.page", () => {
  it("answers the whole thread with no paging, a long tool result trimmed and counted", async () => {
    const { threadPageVerb } = await seeded();
    const page = await threadPageVerb({ id: "c1" });
    expect(page.start).toBe(0);
    expect(page.total).toBe(3);
    expect(page.items[1]).toMatchObject({ kind: "tool", id: "t1", resultBytes: LONG.length });
    expect((page.items[1] as { result?: string }).result).toBeUndefined();
    expect(loadTranscript).toHaveBeenCalledOnce();
  });

  it("pages newest first with before and limit, and reads a bad number as unset", async () => {
    const { threadPageVerb } = await seeded();
    expect(await threadPageVerb({ id: "c1", limit: 1 })).toMatchObject({ items: [items[2]], start: 2, total: 3 });
    expect(await threadPageVerb({ id: "c1", before: 1.9, limit: 5 })).toMatchObject({ items: [items[0]], start: 0, total: 3 });
    expect((await threadPageVerb({ id: "c1", before: Number.NaN, limit: "2" })).items).toHaveLength(3);
  });

  it("still answers when the transcript can't be read, and 404s a card that isn't here", async () => {
    const { threadPageVerb, NotFound } = await seeded();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    loadTranscript.mockRejectedValueOnce(new Error("eacces"));
    expect((await threadPageVerb({ id: "c1" })).total).toBe(3);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    await expect(threadPageVerb({ id: "ghost" })).rejects.toBeInstanceOf(NotFound);
  });
});

describe("thread.search", () => {
  it("finds which items hold the phrase, and nothing for no phrase", async () => {
    const { threadSearchVerb } = await seeded();
    expect(await threadSearchVerb({ id: "c1", q: "NEEDLE" })).toEqual({ matches: [{ index: 0, hits: 1 }] });
    expect(await threadSearchVerb({ id: "c1", q: 7 })).toEqual({ matches: [] });
    await expect(threadSearchVerb({ id: "ghost", q: "x" })).rejects.toThrow("No such card.");
  });
});

describe("thread.tool", () => {
  it("answers a trimmed result whole, and 404s one that isn't there", async () => {
    const { threadToolVerb, NotFound } = await seeded();
    expect(await threadToolVerb({ id: "c1", toolId: "t1" })).toEqual({ result: LONG });
    await expect(threadToolVerb({ id: "c1", toolId: "nope" })).rejects.toBeInstanceOf(NotFound);
    await expect(threadToolVerb({ id: "c1", toolId: "nope" })).rejects.toThrow("No such tool result.");
    await expect(threadToolVerb({ id: "c1", toolId: 7 })).rejects.toBeInstanceOf(NotFound);
    await expect(threadToolVerb({ id: "ghost", toolId: "t1" })).rejects.toThrow("No such card.");
  });
});
