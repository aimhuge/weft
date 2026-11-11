import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrashEntry } from "./card-trash-file";
import type { Card } from "./types";

// Recently deleted: deleteCard keeps the card in DATA_DIR/trash, listTrash and restoreFromTrash read it back.
// store.ts reads WEFT_DATA once at import, so each test points it at a fresh temp dir and re-imports both.
let dir: string;
const g = globalThis as unknown as { __weftState?: unknown };
const DAY = 24 * 60 * 60 * 1000;

async function load() {
  vi.resetModules();
  delete g.__weftState;
  const store = await import("./store");
  const trash = await import("./card-trash");
  const file = await import("./card-trash-file");
  return { store, trash, file };
}

type Store = Awaited<ReturnType<typeof load>>["store"];
const input = (over: Partial<Card> = {}) =>
  ({ title: "t", prompt: "p", cwd: "/tmp", backend: "claude", ...over }) as Parameters<Store["createCard"]>[0];
const trashPath = (id: string) => path.join(dir, "trash", `${id}.json`);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-trash-"));
  process.env.WEFT_DATA = dir;
});
afterEach(() => {
  vi.restoreAllMocks();
  delete g.__weftState;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("deleteCard keeps the card", () => {
  it("writes the card, its thread and when it went to trash/<id>.json", async () => {
    const { store } = await load();
    store.createCard(input({ title: "Fix login" }), "a");
    store.appendThread("a", { kind: "user", text: "hi", at: 1 });
    store.deleteCard("a");
    const entry = JSON.parse(fs.readFileSync(trashPath("a"), "utf8")) as TrashEntry;
    expect(entry.card).toMatchObject({ id: "a", title: "Fix login" });
    expect(entry.thread).toEqual([{ kind: "user", text: "hi", at: 1 }]);
    expect(typeof entry.deletedAt).toBe("number");
    expect(store.getCard("a")).toBeUndefined();
  });

  it("still deletes when keeping it fails", async () => {
    const { store } = await load();
    store.createCard(input(), "b");
    fs.writeFileSync(path.join(dir, "trash"), "a file where the folder goes");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => store.deleteCard("b")).not.toThrow();
    expect(store.getCard("b")).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("keeps nothing for a card that isn't on the board", async () => {
    const { store } = await load();
    store.deleteCard("ghost");
    expect(fs.existsSync(path.join(dir, "trash"))).toBe(false);
  });
});

describe("keepDeleted", () => {
  it("refuses an id that would name a file outside the trash", async () => {
    const { file } = await load();
    for (const id of ["", ".", "..", "../x", "a/b", "a\\b"]) {
      expect(file.trashFile(dir, id)).toBeNull();
      expect(file.keepDeleted(dir, { id } as Card, () => [])).toBe(false);
    }
    expect(fs.existsSync(path.join(dir, "trash"))).toBe(false);
  });

  it("uses the time it's given", async () => {
    const { file } = await load();
    expect(file.keepDeleted(dir, { id: "t", title: "x", cwd: "/" } as Card, () => [], 42)).toBe(true);
    expect((JSON.parse(fs.readFileSync(trashPath("t"), "utf8")) as TrashEntry).deletedAt).toBe(42);
  });
});

describe("listTrash", () => {
  it("is empty before anything was deleted", async () => {
    const { trash } = await load();
    expect(trash.listTrash()).toEqual([]);
  });

  it("lists newest first, skipping files that aren't entries", async () => {
    const { file, trash } = await load();
    const now = 100 * DAY;
    file.keepDeleted(dir, { id: "old", title: "Old", cwd: "/a" } as Card, () => [], now - 2 * DAY);
    file.keepDeleted(dir, { id: "new", title: "New", cwd: "/b" } as Card, () => [], now - DAY);
    fs.writeFileSync(trashPath("broken"), "{not json");
    fs.writeFileSync(trashPath("shape"), JSON.stringify({ nope: true }));
    fs.writeFileSync(path.join(dir, "trash", "notes.txt"), "x");
    fs.writeFileSync(path.join(dir, "trash", ".x.json.1.tmp.json"), "{}");
    expect(trash.listTrash(now)).toEqual([
      { id: "new", title: "New", cwd: "/b", deletedAt: now - DAY },
      { id: "old", title: "Old", cwd: "/a", deletedAt: now - 2 * DAY },
    ]);
  });

  it("purges entries older than 30 days first", async () => {
    const { file, trash } = await load();
    const now = 100 * DAY;
    file.keepDeleted(dir, { id: "gone", title: "g", cwd: "/" } as Card, () => [], now - 31 * DAY);
    file.keepDeleted(dir, { id: "kept", title: "k", cwd: "/" } as Card, () => [], now - 29 * DAY);
    expect(trash.listTrash(now).map((i) => i.id)).toEqual(["kept"]);
    expect(fs.existsSync(trashPath("gone"))).toBe(false);
  });
});

describe("purgeTrash", () => {
  it("goes by a broken file's age when it has no deletedAt, and says how many went", async () => {
    const { file, trash } = await load();
    file.keepDeleted(dir, { id: "fresh", title: "f", cwd: "/" } as Card, () => []);
    fs.writeFileSync(trashPath("broken"), "{not json");
    const old = new Date(Date.now() - 40 * DAY);
    fs.utimesSync(trashPath("broken"), old, old);
    expect(trash.purgeTrash()).toBe(1);
    expect(fs.existsSync(trashPath("broken"))).toBe(false);
    expect(fs.existsSync(trashPath("fresh"))).toBe(true);
    expect(trash.purgeTrash()).toBe(0);
  });
});

describe("restoreFromTrash", () => {
  it("puts the card and its thread back and empties its place in the trash", async () => {
    const { store, trash } = await load();
    const { subscribe } = await import("./bus");
    store.createCard(input({ title: "Back" }), "r");
    store.appendThread("r", { kind: "user", text: "hi", at: 1 });
    store.deleteCard("r");
    const seen: string[] = [];
    const off = subscribe((e) => seen.push(e.type));
    const card = trash.restoreFromTrash("r");
    off();
    expect(card).toMatchObject({ id: "r", title: "Back", column: "backlog", warm: false });
    expect(store.getCard("r")).toBe(card);
    expect(store.getThread("r")).toEqual([{ kind: "user", text: "hi", at: 1 }]);
    expect(fs.existsSync(path.join(dir, "threads", "r.json"))).toBe(true);
    expect(fs.existsSync(trashPath("r"))).toBe(false);
    expect(seen).toContain("card");
    expect(trash.listTrash()).toEqual([]);
  });

  it("lands a card that was running, or waiting on a permission, in Review with its subagents ended", async () => {
    const { file, trash } = await load();
    const running = {
      id: "run",
      title: "r",
      cwd: "/",
      column: "running",
      warm: true,
      wrappingUp: true,
      tasks: [{ id: "t1", status: "running" }],
      createdAt: 1,
      updatedAt: 1,
    } as unknown as Card;
    file.keepDeleted(dir, running, () => []);
    const card = trash.restoreFromTrash("run", Date.now());
    expect(card.column).toBe("review");
    expect(card.pending).toBeNull();
    expect(card.wrappingUp).toBeUndefined();
    expect(card.tasks?.[0]).toMatchObject({ status: "lost" });

    file.keepDeleted(dir, { id: "ask", title: "a", cwd: "/", column: "needs_you", pending: { id: "p" } } as unknown as Card, () => []);
    expect(trash.restoreFromTrash("ask")).toMatchObject({ column: "review", pending: null });
  });

  it("restores an entry saved with no thread as an empty one", async () => {
    const { store, trash } = await load();
    fs.mkdirSync(path.join(dir, "trash"), { recursive: true });
    fs.writeFileSync(trashPath("bare"), JSON.stringify({ card: { id: "bare", title: "b", cwd: "/", column: "done" }, deletedAt: Date.now() }));
    expect(trash.restoreFromTrash("bare").column).toBe("done");
    expect(store.getThread("bare")).toEqual([]);
  });

  it("refuses a card that isn't there, has expired, has a bad id or is already back on the board", async () => {
    const { store, file, trash } = await load();
    expect(() => trash.restoreFromTrash("missing")).toThrow("isn't in Recently deleted");
    expect(() => trash.restoreFromTrash("../board")).toThrow("isn't in Recently deleted");
    fs.mkdirSync(path.join(dir, "trash"), { recursive: true });
    fs.writeFileSync(path.join(dir, "trash", "junk.json"), "{");
    expect(() => trash.restoreFromTrash("junk")).toThrow("isn't in Recently deleted");
    file.keepDeleted(dir, { id: "stale", title: "s", cwd: "/" } as Card, () => [], Date.now() - 31 * DAY);
    expect(() => trash.restoreFromTrash("stale")).toThrow("isn't in Recently deleted");
    store.createCard(input(), "dup");
    file.keepDeleted(dir, { id: "dup", title: "d", cwd: "/" } as Card, () => []);
    expect(() => trash.restoreFromTrash("dup")).toThrow("already on the board");
    expect(fs.existsSync(trashPath("dup"))).toBe(true);
  });
});
