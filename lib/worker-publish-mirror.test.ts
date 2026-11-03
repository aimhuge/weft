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
});

describe("the session lines' snapshot (card.list)", () => {
  const KEY = "sk-ant-api03-" + "A".repeat(90);

  it("projects every card the store has but the copilot, with its folder, and sends nothing", async () => {
    const { reg } = fakeReg();
    const cards = { "card-1": card({ title: `use ${KEY}` }), co: card({ id: "co", role: "copilot" }) };
    const p = createPublisher(reg, { ...fakeSource(cards, {}), listCards: () => Object.values(cards) });
    p.nameFolder("card-1", "weft-app");
    const snap = await p.snapshot();
    expect(snap.map((s) => [s.card.id, s.folder])).toEqual([["card-1", "weft-app"]]);
    expect(snap[0]?.card.title).not.toContain(KEY);
    expect(reg.putCard).not.toHaveBeenCalled();
  });

  it("without a list, is the cards it has shipped so far that are still here", async () => {
    const { reg } = fakeReg();
    const cards: Record<string, Card> = { "card-1": card(), "card-2": card({ id: "card-2", cwd: "/srv/work/other" }) };
    const p = createPublisher(reg, fakeSource(cards, {}));
    expect(await p.snapshot()).toEqual([]);
    p.hear({ type: "card", card: cards["card-1"]! });
    p.hear({ type: "card", card: cards["card-2"]! });
    await p.flush();
    delete cards["card-2"];
    expect((await p.snapshot()).map((s) => [s.card.id, s.folder])).toEqual([["card-1", "weft"]]);
  });
});
