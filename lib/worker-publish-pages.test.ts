import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as cards from "./cloud-sync-cards";
import { createPublisher, type PublishedPages, type PublishSource } from "./worker-publish";
import type { Card, ThreadItem } from "./types";
import type { BoardEvent } from "./types-card";
import type { ItemRow, OutputRow } from "./worker-registry";

// The publisher with a blob store: a page a card opened reaches the row as a ref (lib/worker-publish.ts).
const card = (over: Partial<Card> = {}): Card => ({ id: "card-1", title: "Plan", cwd: "/srv/work/ling", column: "run", ...over }) as Card;

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

describe("the publisher's pages", () => {
  const REF = `blob:sha256:${"a".repeat(64)}`;
  const page = "/home/me/.weft-worker/data/show/plan.html";
  const blobs = (over: Partial<PublishedPages["blobs"]> = {}): PublishedPages["blobs"] => ({
    refFor: vi.fn(() => Promise.resolve(null)),
    upload: vi.fn(() => Promise.resolve(null)),
    uploadPage: vi.fn(() => Promise.resolve(REF as never)),
    rewriteItem: vi.fn((item: ThreadItem) => Promise.resolve(item.kind === "tool" ? { ...item, summary: REF } : item)),
    ...over,
  });
  const open = toolItem({ name: "mcp__browser__open_url", summary: `file://${page}` });
  const hear = (p: ReturnType<typeof createPublisher>) => {
    p.hear({ type: "card", card: card() } as unknown as BoardEvent);
    p.hear({ type: "thread", cardId: "card-1", index: 0, item: open } as unknown as BoardEvent);
  };

  it("swaps an open_url item's path for its ref, and leaves the card's own thread alone", async () => {
    const { putItems, reg } = fakeReg();
    const thread = [open];
    const p = createPublisher(reg, fakeSource({ "card-1": card() }, { "card-1": thread }), vi.fn(), { blobs: blobs(), orgId: "org" });
    hear(p);
    await p.flush();
    expect((putItems.mock.calls[0]?.[1][0]?.item as { summary: string }).summary).toBe(REF);
    expect((thread[0] as { summary: string }).summary).toBe(`file://${page}`);
  });

  it("still ships the item when its upload fails", async () => {
    const { putItems, reg } = fakeReg();
    const log = vi.fn();
    const failing = blobs({ rewriteItem: vi.fn(() => Promise.reject(new Error("offline"))) });
    const p = createPublisher(reg, fakeSource({ "card-1": card() }, { "card-1": [open] }), log, { blobs: failing, orgId: "org" });
    hear(p);
    await p.flush();
    expect(putItems).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("offline"));
  });

  it("sends a card that can't upload its page with the path it has", async () => {
    const { putCard, reg } = fakeReg();
    const log = vi.fn();
    const p = createPublisher(reg, fakeSource({ "card-1": card() }), log, { blobs: blobs(), orgId: "org" });
    const spy = vi.spyOn(cards, "withUploadedPage").mockRejectedValueOnce(new Error("offline"));
    p.hear({ type: "card", card: card() } as unknown as BoardEvent);
    await p.flush();
    expect(putCard).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("offline"));
    spy.mockRestore();
  });

  it("sends the card's page as a ref, keeping its anchor", async () => {
    const { putCard, reg } = fakeReg();
    fs.mkdirSync(os.homedir(), { recursive: true });
    const home = fs.mkdtempSync(path.join(os.homedir(), "publish-test-"));
    const file = path.join(home, "plan.html");
    fs.writeFileSync(file, "<p>");
    try {
      const shown = card({ page: `file://${file}#two`, pages: 2 });
      const p = createPublisher(reg, fakeSource({ "card-1": shown }), vi.fn(), { blobs: blobs(), orgId: "org" });
      p.hear({ type: "card", card: shown } as unknown as BoardEvent);
      await p.flush();
      expect(putCard.mock.calls[0]?.[2]).toMatchObject({ page: `${REF}#two`, pages: 2 });
      expect(shown.page).toBe(`file://${file}#two`);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
