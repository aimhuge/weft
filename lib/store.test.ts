import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, ThreadItem } from "./types";

// store.ts reads WEFT_DATA once at import, so each test points it at a fresh temp dir
// and re-imports the module. Never the real ~/.weft.
let dir: string;
const g = globalThis as unknown as { __weftState?: unknown };

async function load() {
  vi.resetModules();
  delete g.__weftState;
  return import("./store");
}

type Store = Awaited<ReturnType<typeof load>>;
const input = (over: Partial<Card> = {}) =>
  ({ title: "t", prompt: "p", cwd: "/tmp", backend: "claude", ...over }) as Parameters<Store["createCard"]>[0];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-store-"));
  process.env.WEFT_DATA = dir;
});
afterEach(() => {
  delete g.__weftState;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("store cards", () => {
  it("creates a backlog card, saves it, and lists newest-updated first", async () => {
    const store = await load();
    const a = store.createCard(input({ title: "a", pictures: 0 }), "a");
    expect(a.column).toBe("backlog");
    store.createCard(input({ title: "b", pictures: 0 }), "b");
    await new Promise((r) => setTimeout(r, 5));
    store.updateCard("a", { title: "a2" });
    expect(store.listCards().map((c) => c.id)).toEqual(["a", "b"]);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "board.json"), "utf8")) as { cards: Card[] };
    expect(saved.cards.map((c: Card) => c.title).sort()).toEqual(["a2", "b"]);
  });

  it("stamps columnAt only when the column changes", async () => {
    const store = await load();
    store.createCard(input(), "a");
    expect(store.updateCard("a", { column: "backlog" }).columnAt).toBeUndefined();
    const moved = store.updateCard("a", { column: "review" }).columnAt;
    expect(moved).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 5));
    expect(store.updateCard("a", { title: "t2", column: "review" }).columnAt).toBe(moved);
  });

  it("drops a card's symbol claims at Done and when it's archived", async () => {
    const store = await load();
    store.createCard(input(), "a");
    store.createCard(input(), "b");
    expect(store.updateCard("a", { claims: ["/x.ts#f"] }).claims).toEqual(["/x.ts#f"]);
    expect(store.updateCard("a", { column: "done" }).claims).toBeUndefined();
    store.updateCard("b", { claims: ["/x.ts#f"] });
    expect(store.updateCard("b", { archived: true }).claims).toBeUndefined();
  });

  it("updateCard throws for an unknown card", async () => {
    const store = await load();
    expect(() => store.updateCard("nope", {})).toThrow("No card nope");
  });

  it("deletes the card and its thread file", async () => {
    const store = await load();
    store.createCard(input(), "x");
    store.appendThread("x", { kind: "user", text: "hi", at: 1 });
    expect(fs.existsSync(path.join(dir, "threads", "x.json"))).toBe(true);
    store.deleteCard("x");
    expect(store.getCard("x")).toBeUndefined();
    expect(fs.existsSync(path.join(dir, "threads", "x.json"))).toBe(false);
  });

  it("publishes card events on the bus", async () => {
    const store = await load();
    const { subscribe } = await import("./bus");
    const seen: string[] = [];
    const off = subscribe((e) => seen.push(e.type));
    store.createCard(input(), "e");
    store.deleteCard("e");
    off();
    expect(seen).toEqual(["card", "card_deleted"]);
  });

  it("on restart, a running card or one with a pending permission lands in review", async () => {
    fs.mkdirSync(dir, { recursive: true });
    const base = { prompt: "p", cwd: "/", backend: "claude", createdAt: 1, updatedAt: 1, warm: true };
    fs.writeFileSync(
      path.join(dir, "board.json"),
      JSON.stringify({
        cards: [
          { ...base, id: "r", title: "r", column: "running", wrappingUp: true },
          { ...base, id: "p", title: "p", column: "needs_you", pending: { id: "1" } },
          { ...base, id: "d", title: "d", column: "done" },
        ],
      }),
    );
    const store = await load();
    const r = store.getCard("r")!;
    expect(r.column).toBe("review");
    expect(r.lastLine).toBe("Stopped when the app closed");
    expect(r.warm).toBe(false);
    expect(r.interrupted).toBe(true);
    expect(r.wrappingUp).toBeUndefined();
    expect(store.getCard("p")!.column).toBe("review");
    expect(store.getCard("p")!.pending).toBeNull();
    expect(store.getCard("d")!.column).toBe("done");
  });

  it("marks a carry-on turn cut off again for another resume, until three in a row", async () => {
    fs.mkdirSync(dir, { recursive: true });
    const base = { prompt: "p", cwd: "/", backend: "claude", createdAt: 1, updatedAt: 1, column: "running" };
    const cards = [{ ...base, id: "again", title: "a", resumes: 2 }, { ...base, id: "stuck", title: "s", resumes: 3 }];
    fs.writeFileSync(path.join(dir, "board.json"), JSON.stringify({ cards }));
    const store = await load();
    expect(store.getCard("again")).toMatchObject({ column: "review", lastLine: "Stopped when the app closed", interrupted: true });
    expect(store.getCard("stuck")!.interrupted).toBeUndefined();
  });

  it("addCards saves many at once", async () => {
    const store = await load();
    const mk = (id: string) => ({ ...input({ pictures: 0 }), id, column: "done", createdAt: 1, updatedAt: 1 }) as Card;
    store.addCards([mk("1"), mk("2")]);
    expect(store.listCards()).toHaveLength(2);
  });
});

describe("store threads", () => {
  it("append returns the index, persists, and survives a reload", async () => {
    let store = await load();
    expect(store.appendThread("c", { kind: "user", text: "one", at: 1 })).toBe(0);
    expect(store.appendThread("c", { kind: "assistant", text: "two", at: 2 })).toBe(1);
    store = await load();
    expect(store.getThread("c").map((i) => i.kind)).toEqual(["user", "assistant"]);
  });

  it("replaceThreadItem, replaceThread and clearThread", async () => {
    const store = await load();
    store.appendThread("c", { kind: "user", text: "one", at: 1 });
    store.replaceThreadItem("c", 0, { kind: "user", text: "edited", at: 1 });
    expect((store.getThread("c")[0] as { text: string }).text).toBe("edited");
    store.replaceThread("c", [
      { kind: "user", text: "a", at: 1 },
      { kind: "user", text: "b", at: 2 },
    ]);
    expect(store.getThread("c")).toHaveLength(2);
    const { subscribe } = await import("./bus");
    const seen: unknown[] = [];
    const off = subscribe((e) => seen.push(e));
    store.clearThread("c");
    off();
    expect(seen).toContainEqual({ type: "thread_cleared", cardId: "c" });
    expect(store.getThread("c")).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "threads", "c.json"), "utf8"))).toEqual([]);
  });

  it("foldThread folds the rest of the thread into one edited item and tells the board to truncate", async () => {
    const store = await load();
    const { subscribe } = await import("./bus");
    const seen: unknown[] = [];
    const off = subscribe((e) => seen.push(e));
    store.appendThread("c", { kind: "user", text: "one", at: 1 });
    store.appendThread("c", { kind: "user", text: "two", at: 2 });
    store.appendThread("c", { kind: "assistant", text: "reply", at: 3 });
    seen.length = 0;
    store.foldThread("c", 1);
    off();
    const folded = { kind: "edited", at: expect.any(Number) as number, items: [{ kind: "user", text: "two", at: 2 }, { kind: "assistant", text: "reply", at: 3 }] };
    expect(store.getThread("c")).toEqual([{ kind: "user", text: "one", at: 1 }, folded]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "threads", "c.json"), "utf8"))).toHaveLength(2);
    expect(seen).toContainEqual({ type: "thread", cardId: "c", item: folded, index: 1, truncate: true });
  });

  it("an unknown thread is empty", async () => {
    const store = await load();
    expect(store.getThread("never")).toEqual([]);
  });
});

describe("store data folder", () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-home-"));
    delete process.env.WEFT_DATA;
    vi.spyOn(os, "homedir").mockReturnValue(home);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("defaults to ~/.weft", async () => {
    expect((await load()).DATA_DIR).toBe(path.join(home, ".weft"));
  });

  it("moves an old ~/.threadboard folder to ~/.weft once", async () => {
    fs.mkdirSync(path.join(home, ".threadboard"));
    fs.writeFileSync(path.join(home, ".threadboard", "board.json"), JSON.stringify({ cards: [] }));
    expect((await load()).DATA_DIR).toBe(path.join(home, ".weft"));
    expect(fs.existsSync(path.join(home, ".weft", "board.json"))).toBe(true);
    expect(fs.existsSync(path.join(home, ".threadboard"))).toBe(false);
  });

  it("leaves ~/.threadboard alone when ~/.weft already exists", async () => {
    fs.mkdirSync(path.join(home, ".threadboard"));
    fs.mkdirSync(path.join(home, ".weft"));
    expect((await load()).DATA_DIR).toBe(path.join(home, ".weft"));
    expect(fs.existsSync(path.join(home, ".threadboard"))).toBe(true);
  });

  it("keeps using ~/.threadboard when the move fails", async () => {
    fs.mkdirSync(path.join(home, ".threadboard"));
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("EPERM");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await load()).DATA_DIR).toBe(path.join(home, ".threadboard"));
    expect(warn).toHaveBeenCalledOnce();
  });
});

const shot = (url: string, at = 1): ThreadItem => ({ kind: "tool", id: `t${at}`, name: "screenshot", summary: "", at, images: [url] });

describe("store pictures", () => {
  const p = globalThis as unknown as { __weftPicturesBackfill?: boolean };
  beforeEach(() => {
    delete p.__weftPicturesBackfill;
  });

  it("appending an image counts it and makes it the thumbnail, and publishes the card", async () => {
    const store = await load();
    const { subscribe } = await import("./bus");
    store.createCard(input(), "c");
    const seen: unknown[] = [];
    subscribe((e) => seen.push(e));
    store.appendThread("c", shot("/api/attachments/a.png"));
    expect(store.getCard("c")).toMatchObject({ pictures: 1, thumb: "/api/attachments/a.png" });
    expect(seen).toContainEqual(expect.objectContaining({ type: "card" }));
  });

  it("a text item leaves pictures alone; a thread item for no card is fine", async () => {
    const store = await load();
    store.createCard(input(), "c");
    store.appendThread("c", { kind: "user", text: "hi", at: 1 });
    expect(store.getCard("c")?.pictures).toBeUndefined();
    expect(store.appendThread("ghost", shot("/api/attachments/a.png"))).toBe(0);
  });

  it("replacing a tool call with its screenshot result adds the picture", async () => {
    const store = await load();
    store.createCard(input(), "c");
    store.appendThread("c", { kind: "tool", id: "t", name: "screenshot", summary: "", at: 1 });
    store.replaceThreadItem("c", 0, shot("/api/attachments/b.png"));
    expect(store.getCard("c")).toMatchObject({ pictures: 1, thumb: "/api/attachments/b.png" });
    store.replaceThreadItem("ghost", 0, shot("/api/attachments/b.png"));
  });

  it("replaceThread recounts the whole thread, and skips the save when nothing changed", async () => {
    const store = await load();
    store.createCard(input(), "c");
    store.replaceThread("c", [shot("/api/attachments/a.png", 1), shot("/api/attachments/b.png", 2)]);
    expect(store.getCard("c")).toMatchObject({ pictures: 2, thumb: "/api/attachments/b.png" });
    const write = vi.spyOn(fs, "renameSync"); // board.json saves rename a temp file over it (lib/atomic-write.ts)
    store.replaceThread("c", [shot("/api/attachments/a.png", 1), shot("/api/attachments/b.png", 2)]);
    expect(write.mock.calls.filter(([, to]) => String(to).endsWith("board.json"))).toHaveLength(0);
    write.mockRestore();
  });

  it("decorateCard sets the thumb and emoji without touching updatedAt", async () => {
    const store = await load();
    const card = store.createCard(input(), "c");
    const before = card.updatedAt;
    store.decorateCard("c", { thumb: "/x.png", emoji: "🧵" });
    expect(store.getCard("c")).toMatchObject({ thumb: "/x.png", emoji: "🧵", updatedAt: before });
    expect(() => store.decorateCard("ghost", { thumb: "/y.png", emoji: "x" })).not.toThrow();
  });

  it("backfills pictures for old cards once, a card per tick, skipping archived ones", async () => {
    let store = await load();
    store.createCard(input(), "old");
    store.createCard(input(), "plain");
    store.createCard(input({ archived: true }), "gone");
    store.createCard(input(), "broken");
    store.createCard(input({ pictures: 3 }), "done");
    store.appendThread("old", shot("/api/attachments/a.png"));
    store.appendThread("gone", shot("/api/attachments/g.png"));
    // Simulate cards saved before thumbnails existed.
    const board = JSON.parse(fs.readFileSync(path.join(dir, "board.json"), "utf8")) as { cards: Card[] };
    for (const c of board.cards) {
      if (c.id === "done") continue;
      delete c.pictures;
      delete c.thumb;
    }
    fs.writeFileSync(path.join(dir, "board.json"), JSON.stringify(board));
    fs.writeFileSync(path.join(dir, "threads", "broken.json"), "{not json");
    store = await load();
    store.getThread("plain"); // already cached: stays cached

    store.listCards();
    store.listCards(); // second call doesn't start another pass
    await vi.waitFor(() => expect(store.getCard("broken")?.pictures).toBe(0));
    await new Promise((r) => setImmediate(r));

    expect(store.getCard("old")).toMatchObject({ pictures: 1, thumb: "/api/attachments/a.png" });
    expect(store.getCard("plain")?.pictures).toBe(0);
    expect(store.getCard("gone")?.pictures).toBeUndefined();
    expect(store.getCard("done")?.pictures).toBe(3);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "board.json"), "utf8")) as { cards: Card[] };
    expect(saved.cards.find((c) => c.id === "old")?.pictures).toBe(1);
  });

  it("backfill does nothing when every card already has pictures", async () => {
    const store = await load();
    store.createCard(input({ pictures: 0 }), "c");
    const write = vi.spyOn(fs, "writeFileSync");
    store.listCards();
    await new Promise((r) => setImmediate(r));
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
  });
});
