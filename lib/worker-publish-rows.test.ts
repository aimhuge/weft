import { describe, expect, it, vi } from "vitest";
import { createPublisher, type PublishSource } from "./worker-publish";
import type { Card, ThreadItem } from "./types";
import type { ItemRow, OutputRow } from "./worker-registry";

// Where the worker's rows used to differ from the Mac's by mistake (lib/card-rows.ts, docs/architecture/project-hosts.md H5a).
const card = (over: Partial<Card> = {}): Card => ({ id: "card-1", title: "Plan", cwd: "/srv/work/weft", column: "run", ...over }) as Card;

const toolItem = (over: Partial<Extract<ThreadItem, { kind: "tool" }>> = {}): ThreadItem => ({ kind: "tool", id: "t1", name: "Bash", summary: "ls", at: 1, ...over });

const fakeSource = (cards: Record<string, Card>, threads: Record<string, ThreadItem[]> = {}): PublishSource => ({
  getCard: (id) => cards[id],
  getThread: (id) => threads[id] ?? [],
});

function fakeReg() {
  const putCard = vi.fn<(id: string, folder: string, card: unknown, deleted?: boolean) => Promise<void>>(() => Promise.resolve());
  const putItems = vi.fn<(id: string, items: ItemRow[], outputs: OutputRow[], fromSeq: number | null) => Promise<void>>(() => Promise.resolve());
  return { putCard, putItems, reg: { putCard, putItems } };
}

describe("the worker's rows, like the Mac's", () => {
  // Its card events were dropped, but a thread event (or track) still shipped the copilot's card and every item.
  it("never ships the copilot, not even from its thread", async () => {
    const { putCard, putItems, reg } = fakeReg();
    const copilot = card({ id: "copilot", role: "copilot" });
    const p = createPublisher(reg, fakeSource({ copilot }, { copilot: [toolItem()] }));
    p.hear({ type: "thread", cardId: "copilot", item: toolItem(), index: 0 });
    p.track("copilot");
    await p.flush();
    expect(putCard).not.toHaveBeenCalled();
    expect(putItems).not.toHaveBeenCalled();
  });

  // worker_put_items is one INSERT ... ON CONFLICT, which Postgres refuses when a batch names one key twice.
  it("sends one output per tool id, the later one, as the Mac's flush does", async () => {
    const { putItems, reg } = fakeReg();
    const long = (c: string) => c.repeat(3000);
    const thread = [toolItem({ id: "item_1", result: long("a") }), toolItem({ id: "item_1", result: long("b") })];
    const p = createPublisher(reg, fakeSource({ "card-1": card() }, { "card-1": thread }));
    p.track("card-1");
    await p.flush();
    const outputs = putItems.mock.calls[0]![2];
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.result).toBe(long("b"));
    expect(putItems.mock.calls[0]![1]).toHaveLength(2);
  });
});
