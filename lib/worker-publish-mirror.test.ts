// The publisher's mirror for session lines (lib/worker-publish.ts mirror): what ships, as it ships.
import { describe, expect, it, vi } from "vitest";
import { createPublisher } from "./worker-publish";
import type { Card, ThreadItem } from "./types";

const card = (over: Partial<Card> = {}): Card => ({ id: "card-1", title: "Dark mode", prompt: "p", cwd: "/srv/work/weft", backend: "claude", permissionMode: "acceptEdits", column: "run", ...over }) as Card;
const toolItem = (over: Partial<Extract<ThreadItem, { kind: "tool" }>> = {}): ThreadItem => ({ kind: "tool", id: "t1", name: "Bash", summary: "ls", at: 0, ...over });
const fakeSource = (cards: Record<string, Card>, threads: Record<string, ThreadItem[]>) => ({ getCard: (id: string) => cards[id], getThread: (id: string) => threads[id] ?? [] });
const fakeReg = () => ({ reg: { putCard: vi.fn(() => Promise.resolve()), putItems: vi.fn(() => Promise.resolve()) } });

describe("the session lines' mirror", () => {
  it("hears each card and item as it ships, a rewind's first item as a truncate, and a delete only for a card it shipped", async () => {
    const { reg } = fakeReg();
    const items = [toolItem(), toolItem({ id: "t2" }), toolItem({ id: "t3" })];
    const copilot = card({ id: "co", role: "copilot" });
    const p = createPublisher(reg, fakeSource({ "card-1": card(), co: copilot }, { "card-1": items, co: [toolItem()] }));
    const heard: unknown[] = [];
    const off = p.mirror((e) => heard.push(e));
    p.hear({ type: "card", card: card() });
    p.hear({ type: "thread", cardId: "card-1", index: 1, item: items[1]!, truncate: true });
    p.hear({ type: "thread", cardId: "card-1", index: 2, item: items[2]! });
    p.hear({ type: "card", card: copilot });
    p.hear({ type: "thread", cardId: "co", index: 0, item: toolItem() });
    await p.flush();
    expect(heard).toEqual([
      { t: "card", card: expect.objectContaining({ id: "card-1" }) as unknown },
      { t: "thread", cardId: "card-1", index: 1, item: expect.objectContaining({ id: "t2" }) as unknown, truncate: true },
      { t: "thread", cardId: "card-1", index: 2, item: expect.objectContaining({ id: "t3" }) as unknown },
    ]);
    heard.length = 0;
    p.hear({ type: "card_deleted", id: "co" });
    p.hear({ type: "card_deleted", id: "card-1" });
    await p.flush();
    expect(heard).toEqual([{ t: "card_deleted", id: "card-1" }]);
    off();
    p.hear({ type: "card", card: card() });
    await p.flush();
    expect(heard).toHaveLength(1);
  });

  it("streams a published card's reply to lines only, and ends it when the reply lands", () => {
    vi.useFakeTimers();
    const { reg } = fakeReg();
    const copilot = card({ id: "co", role: "copilot" });
    const p = createPublisher(reg, fakeSource({ "card-1": card(), co: copilot }, { "card-1": [toolItem()] }));
    // No line listening: nothing is kept.
    p.hear({ type: "delta", cardId: "card-1", text: "unheard " });
    const heard: unknown[] = [];
    p.mirror((e) => heard.push(e));
    p.hear({ type: "delta", cardId: "card-1", text: "Hello there " });
    p.hear({ type: "delta", cardId: "co", text: "copilot " });
    p.hear({ type: "delta", cardId: "nope", text: "gone " });
    vi.advanceTimersByTime(60);
    expect(heard).toEqual([{ t: "delta", cardId: "card-1", index: 1, text: "Hello there " }]);
    p.hear({ type: "delta", cardId: "card-1", text: "more " });
    p.hear({ type: "thread", cardId: "card-1", index: 1, item: { kind: "assistant", text: "Hello there more", at: 0 } as ThreadItem });
    p.hear({ type: "delta", cardId: "card-1", text: "next " });
    p.hear({ type: "card_deleted", id: "card-1" });
    vi.advanceTimersByTime(60);
    expect(heard).toHaveLength(1);
    vi.useRealTimers();
  });
});
