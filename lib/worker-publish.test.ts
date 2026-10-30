import { describe, expect, it, vi } from "vitest";
import { createPublisher, type PublishSource } from "./worker-publish";
import type { Card, ThreadItem } from "./types";
import type { BoardEvent } from "./types-card";
import type { ItemRow, OutputRow } from "./worker-registry";

// A card the publisher can read, and the thread under it.
const card = (over: Partial<Card> = {}): Card =>
  ({
    id: "card-1",
    title: "Dark mode",
    prompt: "Add dark mode",
    cwd: "/srv/work/weft",
    backend: "claude",
    permissionMode: "acceptEdits",
    column: "run",
    ...over,
  }) as Card;

const toolItem = (over: Partial<Extract<ThreadItem, { kind: "tool" }>> = {}): ThreadItem => ({
  kind: "tool",
  id: "t1",
  name: "Bash",
  summary: "ls",
  at: Date.parse("2026-10-29T10:00:00.000Z"),
  ...over,
});

function fakeSource(cards: Record<string, Card>, threads: Record<string, ThreadItem[]> = {}): PublishSource {
  return {
    getCard: (id) => cards[id],
    getThread: (id) => threads[id] ?? [],
  };
}

function fakeReg() {
  const putCard = vi.fn<(id: string, folder: string, card: unknown, deleted?: boolean) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const putItems = vi.fn<(id: string, items: ItemRow[], outputs: OutputRow[], fromSeq: number | null) => Promise<void>>(
    () => Promise.resolve(),
  );
  return { putCard, putItems, reg: { putCard, putItems } };
}

describe("the publisher", () => {
  it("sends the card when it hears one", async () => {
    const { putCard, putItems, reg } = fakeReg();
    const source = fakeSource({ "card-1": card() });
    const p = createPublisher(reg, source);
    p.hear({ type: "card", card: card() });
    await p.flush();
    expect(putCard).toHaveBeenCalledExactlyOnceWith("card-1", "weft", expect.objectContaining({ id: "card-1" }), false);
    expect(putItems).not.toHaveBeenCalled();
  });

  it("ignores the copilot's card", async () => {
    const { putCard, reg } = fakeReg();
    const p = createPublisher(reg, fakeSource({}));
    p.hear({ type: "card", card: card({ id: "copilot-1", role: "copilot" }) });
    await p.flush();
    expect(putCard).not.toHaveBeenCalled();
  });

  it("uses the folder the command named, not the card's path", async () => {
    const { putCard, reg } = fakeReg();
    const p = createPublisher(reg, fakeSource({ "card-1": card({ cwd: "/srv/work/weft" }) }));
    p.nameFolder("card-1", "acme");
    p.hear({ type: "card", card: card() });
    await p.flush();
    expect(putCard).toHaveBeenCalledWith("card-1", "acme", expect.anything(), false);
  });

  it("falls back to the card's own folder when none was named", async () => {
    const { putCard, reg } = fakeReg();
    const p = createPublisher(reg, fakeSource({ "card-1": card({ cwd: "/srv/work/other" }) }));
    p.hear({ type: "card", card: card() });
    await p.flush();
    expect(putCard).toHaveBeenCalledWith("card-1", "other", expect.anything(), false);
  });

  it("sends the thread items it heard, in order", async () => {
    const { putItems, reg } = fakeReg();
    const thread = [
      { kind: "user", text: "hello", at: Date.parse("2026-10-29T10:00:00.000Z") },
      toolItem({ id: "t1" }),
      { kind: "assistant", text: "done", at: Date.parse("2026-10-29T10:00:02.000Z") },
    ] as ThreadItem[];
    const p = createPublisher(reg, fakeSource({ "card-1": card() }, { "card-1": thread }));
    p.hear({ type: "thread", cardId: "card-1", item: thread[2] as ThreadItem, index: 2 });
    p.hear({ type: "thread", cardId: "card-1", item: thread[0] as ThreadItem, index: 0 });
    await p.flush();
    expect(putItems).toHaveBeenCalledTimes(1);
    const [cardId, items, outputs, fromSeq] = putItems.mock.calls[0]!;
    expect(cardId).toBe("card-1");
    expect(items.map((i) => i.seq)).toEqual([0, 2]);
    expect(items[0]).toMatchObject({ seq: 0, kind: "user", at: "2026-10-29T10:00:00.000Z" });
    expect(outputs).toEqual([]);
    expect(fromSeq).toBeNull();
  });

  it("skips a seq the thread no longer has", async () => {
    const { putItems, reg } = fakeReg();
    const thread = [{ kind: "user", text: "hello", at: 1 }] as ThreadItem[];
    const p = createPublisher(reg, fakeSource({ "card-1": card() }, { "card-1": thread }));
    p.hear({ type: "thread", cardId: "card-1", item: thread[0] as ThreadItem, index: 0 });
    p.hear({ type: "thread", cardId: "card-1", item: thread[0] as ThreadItem, index: 7 });
    await p.flush();
    const items = putItems.mock.calls[0]![1];
    expect(items.map((i) => i.seq)).toEqual([0]);
  });

  it("cuts a long tool result out into an output row", async () => {
    const { putItems, reg } = fakeReg();
    const long = "x".repeat(3000);
    const thread = [toolItem({ id: "t1", result: long })] as ThreadItem[];
    const p = createPublisher(reg, fakeSource({ "card-1": card() }, { "card-1": thread }));
    p.hear({ type: "thread", cardId: "card-1", item: thread[0] as ThreadItem, index: 0 });
    await p.flush();
    const [, items, outputs] = putItems.mock.calls[0]!;
    expect(items[0]).toMatchObject({ seq: 0, kind: "tool" });
    expect(items[0]?.item).not.toHaveProperty("result");
    expect(items[0]?.item).toMatchObject({ resultBytes: 3000 });
    expect(outputs).toEqual([{ tool_id: "t1", result: long, bytes: 3000 }]);
  });

  it("keeps a short tool result inline", async () => {
    const { putItems, reg } = fakeReg();
    const thread = [toolItem({ id: "t1", result: "ok" })] as ThreadItem[];
    const p = createPublisher(reg, fakeSource({ "card-1": card() }, { "card-1": thread }));
    p.hear({ type: "thread", cardId: "card-1", item: thread[0] as ThreadItem, index: 0 });
    await p.flush();
    const [, items, outputs] = putItems.mock.calls[0]!;
    expect(items[0]?.item).toMatchObject({ result: "ok" });
    expect(outputs).toEqual([]);
  });

  it("carries the seq a rewind dropped from", async () => {
    const { putItems, reg } = fakeReg();
    const thread = [{ kind: "user", text: "hello", at: 1 }] as ThreadItem[];
    const p = createPublisher(reg, fakeSource({ "card-1": card() }, { "card-1": thread }));
    p.hear({ type: "thread", cardId: "card-1", item: thread[0] as ThreadItem, index: 3, truncate: true });
    await p.flush();
    const [, , , fromSeq] = putItems.mock.calls[0]!;
    expect(fromSeq).toBe(4);
  });

  it("takes the lowest seq of several rewinds", async () => {
    const { putItems, reg } = fakeReg();
    const thread = [{ kind: "user", text: "hello", at: 1 }] as ThreadItem[];
    const p = createPublisher(reg, fakeSource({ "card-1": card() }, { "card-1": thread }));
    p.hear({ type: "thread", cardId: "card-1", item: thread[0] as ThreadItem, index: 5, truncate: true });
    p.hear({ type: "thread", cardId: "card-1", item: thread[0] as ThreadItem, index: 2, truncate: true });
    await p.flush();
    const [, , , fromSeq] = putItems.mock.calls[0]!;
    expect(fromSeq).toBe(3);
  });

  it("sends a rewind on its own, with no items", async () => {
    const { putItems, reg } = fakeReg();
    const p = createPublisher(reg, fakeSource({ "card-1": card() }));
    p.hear({ type: "thread", cardId: "card-1", item: toolItem(), index: 2, truncate: true });
    await p.flush();
    const [, items, outputs, fromSeq] = putItems.mock.calls[0]!;
    expect(items).toEqual([]);
    expect(outputs).toEqual([]);
    expect(fromSeq).toBe(3);
  });

  it("marks a deleted card as deleted", async () => {
    const { putCard, putItems, reg } = fakeReg();
    const p = createPublisher(reg, fakeSource({ "card-1": card() }));
    p.hear({ type: "card_deleted", id: "card-1" });
    await p.flush();
    expect(putCard).toHaveBeenCalledExactlyOnceWith("card-1", "", {}, true);
    expect(putItems).not.toHaveBeenCalled();
  });

  it("uses the named folder on a delete too", async () => {
    const { putCard, reg } = fakeReg();
    const p = createPublisher(reg, fakeSource({}));
    p.nameFolder("card-1", "acme");
    p.hear({ type: "card_deleted", id: "card-1" });
    await p.flush();
    expect(putCard).toHaveBeenCalledWith("card-1", "acme", {}, true);
  });

  it("skips a card the worker doesn't have", async () => {
    const { putCard, putItems, reg } = fakeReg();
    const p = createPublisher(reg, fakeSource({}));
    p.hear({ type: "card", card: card({ id: "card-9" }) });
    await p.flush();
    expect(putCard).not.toHaveBeenCalled();
    expect(putItems).not.toHaveBeenCalled();
  });

  it("sends every item of a card it tracks", async () => {
    const { putCard, putItems, reg } = fakeReg();
    const thread = [
      { kind: "user", text: "one", at: 1 },
      { kind: "assistant", text: "two", at: 2 },
      { kind: "assistant", text: "three", at: 3 },
    ] as ThreadItem[];
    const p = createPublisher(reg, fakeSource({ "card-1": card() }, { "card-1": thread }));
    p.track("card-1");
    await p.flush();
    expect(putCard).toHaveBeenCalledTimes(1);
    const items = putItems.mock.calls[0]![1];
    expect(items.map((i) => i.seq)).toEqual([0, 1, 2]);
  });

  it("logs a failed card and keeps going", async () => {
    const putCard = vi.fn(() => Promise.reject(new Error("boom")));
    const putItems = vi.fn(() => Promise.resolve());
    const log = vi.fn();
    const p = createPublisher({ putCard, putItems }, fakeSource({ "card-1": card() }), log);
    p.hear({ type: "card", card: card() });
    await expect(p.flush()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("Weft Worker: couldn't publish card-1: boom");
  });

  it("logs a failed thread batch and keeps going", async () => {
    const putCard = vi.fn(() => Promise.resolve());
    const putItems = vi.fn(() => Promise.reject(new Error("nope")));
    const log = vi.fn();
    const thread = [{ kind: "user", text: "one", at: 1 }] as ThreadItem[];
    const p = createPublisher({ putCard, putItems }, fakeSource({ "card-1": card() }, { "card-1": thread }), log);
    p.hear({ type: "thread", cardId: "card-1", item: thread[0] as ThreadItem, index: 0 });
    await expect(p.flush()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("Weft Worker: couldn't publish card-1: nope");
  });

  it("does nothing when there is nothing dirty", async () => {
    const { putCard, putItems, reg } = fakeReg();
    const p = createPublisher(reg, fakeSource({}));
    await p.flush();
    expect(putCard).not.toHaveBeenCalled();
    expect(putItems).not.toHaveBeenCalled();
  });

  it("joins a flush that is already running, then sends what came in meanwhile", async () => {
    // The first card row hangs until the gate opens; the rows after it go straight through.
    let open = false;
    const waiters: (() => void)[] = [];
    const putCard = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          if (open) resolve();
          else waiters.push(resolve);
        }),
    );
    const p = createPublisher({ putCard, putItems: vi.fn() }, fakeSource({ "card-1": card() }));
    p.hear({ type: "card", card: card() });
    const first = p.flush();
    // Let the first flush reach the card row: it is still in flight now.
    await vi.waitFor(() => expect(putCard).toHaveBeenCalledTimes(1));
    p.hear({ type: "card", card: card() });
    const second = p.flush();
    open = true;
    for (const resolve of waiters) resolve();
    await Promise.all([first, second]);
    expect(putCard).toHaveBeenCalledTimes(2);
  });

  it("sends what arrived during a flush in the same flush", async () => {
    const { putCard, reg } = fakeReg();
    const p = createPublisher(reg, fakeSource({ "card-1": card() }));
    p.hear({ type: "card", card: card() });
    const flushing = p.flush();
    p.hear({ type: "card", card: card() });
    await flushing;
    expect(putCard).toHaveBeenCalledTimes(2);
  });

  it("ignores the events it doesn't publish", async () => {
    const { putCard, putItems, reg } = fakeReg();
    const p = createPublisher(reg, fakeSource({ "card-1": card() }));
    const events: BoardEvent[] = [
      { type: "thread_cleared", cardId: "card-1" },
      { type: "delta", cardId: "card-1", text: "x" },
      { type: "account" },
      { type: "crons" },
    ];
    for (const event of events) p.hear(event);
    await p.flush();
    expect(putCard).not.toHaveBeenCalled();
    expect(putItems).not.toHaveBeenCalled();
  });

  it("scrubs the card and the items it sends", async () => {
    const { putCard, putItems, reg } = fakeReg();
    const thread = [{ kind: "user", text: "before\u0000after", at: 1 }] as ThreadItem[];
    const p = createPublisher(reg, fakeSource({ "card-1": card({ title: "a\u0000b" }) }, { "card-1": thread }));
    p.hear({ type: "card", card: card({ title: "a\u0000b" }) });
    p.hear({ type: "thread", cardId: "card-1", item: thread[0] as ThreadItem, index: 0 });
    await p.flush();
    const sent = putCard.mock.calls[0]![2] as { title: string };
    expect(sent.title).toBe("ab");
    const items = putItems.mock.calls[0]![1];
    expect((items[0]?.item as { text: string }).text).toBe("beforeafter");
  });
});
