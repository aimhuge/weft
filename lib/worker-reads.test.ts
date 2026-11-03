// lib/worker-reads.ts on its own: a page projected at its own indices, a tool result redacted, a find over the
// projection, and card.list as the publisher's snapshot.
import { describe, expect, it, vi } from "vitest";
import type { Card } from "./types";
import { threadRead, workerReads } from "./worker-reads";

const KEY = "sk-ant-api03-" + "B".repeat(90);

describe("threadRead", () => {
  it("projects a page's items, leaving start and total", async () => {
    const host = vi.fn(() => Promise.resolve({ items: [{ kind: "assistant", text: `k ${KEY}`, at: 1 }], start: 7, total: 8 }));
    const page = (await threadRead(host, "thread.page", { id: "c1", before: 8 })) as { items: { text: string }[]; start: number; total: number };
    expect(host).toHaveBeenCalledWith("thread.page", { id: "c1", before: 8 });
    expect([page.start, page.total]).toEqual([7, 8]);
    expect(page.items[0]?.text).not.toContain(KEY);
  });

  it("redacts a tool result, and searches the whole projected thread", async () => {
    expect(await threadRead(() => Promise.resolve({ result: KEY }), "thread.tool", { id: "c1", toolId: "t" })).not.toEqual({ result: KEY });
    const host = vi.fn(() => Promise.resolve({ items: [{ kind: "user", text: "find me", at: 1 }], start: 0, total: 1 }));
    expect(await threadRead(host, "thread.search", { id: "c1", q: "FIND" })).toEqual({ matches: [{ index: 0, hits: 1 }] });
    expect(host).toHaveBeenCalledWith("thread.page", { id: "c1" });
  });
});

describe("workerReads", () => {
  it("answers card.list with the publisher's snapshot and thread reads through the engine", async () => {
    const snapshot = vi.fn(() => Promise.resolve([{ card: { id: "c1" } as Card, folder: "weft" }]));
    const host = vi.fn(() => Promise.resolve({ result: "ok" }));
    const reads = workerReads({ host }, { snapshot });
    expect(await reads.cards()).toEqual({ cards: [{ card: { id: "c1" }, folder: "weft" }] });
    expect(await reads.threads("thread.tool", { id: "c1", toolId: "t" })).toEqual({ result: "ok" });
    expect(host).toHaveBeenCalledWith("thread.tool", { id: "c1", toolId: "t" });
  });
});
