import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlobStore, OutboxEntry } from "./cloud-sync-types";
import type { Card, ThreadItem } from "./types";

const cards = new Map<string, Card>();
const threads = new Map<string, ThreadItem[]>();

vi.mock("./store", () => ({
  getCard: (id: string) => cards.get(id),
  getThread: (id: string) => threads.get(id) ?? [],
  listCards: () => [...cards.values()],
  get DATA_DIR() {
    return process.env.WEFT_DATA;
  },
}));

const blobs: BlobStore = {
  refFor: vi.fn(() => Promise.resolve(null)),
  upload: vi.fn(() => Promise.resolve(null)),
  rewriteItem: (item) => Promise.resolve(item),
};

type Upsert = (rows: Record<string, unknown>[], body: string) => { error: { message: string; code?: string } | null };

// A Supabase client that records every upsert per table and answers through a script per table. Like
// postgrest-js, the builder sends through its own `fetch` field, so the script sees the body on the wire.
function fakeClient(script: Partial<Record<string, Upsert>> = {}) {
  const sent: Record<string, Record<string, unknown>[][]> = {};
  const bodies: Record<string, string[]> = {};
  const client = {
    from: (table: string) => ({
      upsert: (rows: Record<string, unknown>[]) => {
        (sent[table] ??= []).push(rows);
        const builder = {
          fetch: (_url: string, init: { body: string }) => Promise.resolve(init.body),
          then(ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) {
            return builder
              .fetch("/rest/v1/" + table, { body: JSON.stringify(rows) })
              .then((body) => ((bodies[table] ??= []).push(body), script[table]?.(rows, body) ?? { error: null }))
              .then(ok, bad);
          },
        };
        return builder;
      },
      update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
      delete: () => ({ eq: () => ({ eq: () => ({ gte: () => Promise.resolve({ error: null }) }) }) }),
    }),
  };
  return { client: client as never, sent, bodies };
}

// Cloudflare's block page, as postgrest-js hands it back: the HTML body in `message`.
const WAF = {
  error: {
    message: '<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title></head><body><h1>Sorry, you have been blocked</h1>Cloudflare Ray ID: <strong class="font-semibold">a4f0d5779d1bd32a</strong></body></html>',
  },
};

let dir: string;

beforeEach(() => {
  vi.resetModules();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-cloud-upload-"));
  process.env.WEFT_DATA = dir;
  cards.clear();
  threads.clear();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function addCard(id: string, items: Record<string, unknown>[]) {
  cards.set(id, { id, title: id, prompt: "", cwd: "/sync", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0 });
  threads.set(id, items.map((item, i) => ({ kind: "assistant", text: `m${i}`, at: 1000 + i, ...item })));
}

const itemEntries = (id: string, n: number): OutboxEntry[] => Array.from({ length: n }, (_, seq) => ({ op: "item", cardId: id, seq, at: 1 }));

async function run(pending: OutboxEntry[], client: never) {
  const { appendOutbox, readOutbox } = await import("./cloud-outbox");
  const { uploadPending } = await import("./cloud-sync-upload");
  appendOutbox(pending);
  const shipped: number[] = [];
  const skipped = await uploadPending({ blobs, now: () => 5000 }, client, "o1", pending, (n) => shipped.push(n));
  return { skipped, shipped, left: readOutbox() };
}

describe("scrub", () => {
  it("drops NULs and replaces lone surrogates, deep in objects and arrays, and leaves clean values alone", async () => {
    const { scrub } = await import("./cloud-sync-upload");
    expect(scrub("a\u0000b")).toBe("ab");
    expect(scrub("x\ud83dy")).toBe("x�y");
    expect(scrub("lone low \ude00")).toBe("lone low �");
    expect(scrub("ok \u{1F600} fine")).toBe("ok \u{1F600} fine");
    expect(scrub({ a: ["\u0000", { b: "c\u0000d", n: 3, t: true, z: null }] })).toEqual({ a: ["", { b: "cd", n: 3, t: true, z: null }] });
  });
});

describe("uploadPending", () => {
  it("sends a NUL-bearing item and card without the NUL, instead of failing the whole batch", async () => {
    addCard("c1", [{ text: "ran ls\u0000 done" }]);
    cards.get("c1")!.title = "bad\u0000title";
    const { client, sent } = fakeClient();
    const { left } = await run([{ op: "card", cardId: "c1", at: 1 }, ...itemEntries("c1", 1)], client);
    expect(JSON.stringify(sent)).not.toContain("\\u0000");
    expect((sent.cloud_cards![0]![0]!.card as Card).title).toBe("badtitle");
    expect(sent.cloud_thread_items).toHaveLength(1);
    expect(left).toEqual([]);
  });

  it("uploads in chunks and drops each from the outbox as it lands, so a late failure keeps only the rest", async () => {
    addCard("c1", Array.from({ length: 250 }, () => ({})));
    let calls = 0;
    const { client, sent } = fakeClient({ cloud_thread_items: () => (++calls === 3 ? { error: { message: "fetch failed", code: "" } } : { error: null }) });
    const { appendOutbox, readOutbox } = await import("./cloud-outbox");
    const { uploadPending, ITEM_CHUNK } = await import("./cloud-sync-upload");
    const pending = itemEntries("c1", 250);
    appendOutbox(pending);
    const shipped: number[] = [];
    await expect(uploadPending({ blobs, now: () => 5000 }, client, "o1", pending, (n) => shipped.push(n))).rejects.toThrow("fetch failed");
    expect(ITEM_CHUNK).toBe(100);
    expect(sent.cloud_thread_items!.map((rows) => rows.length)).toEqual([100, 100, 50]);
    expect(shipped).toEqual([100, 100]);
    expect(readOutbox()).toHaveLength(50);
    expect(readOutbox()[0]).toMatchObject({ op: "item", seq: 200 });
  });

  it("skips the one row the server refuses for good and ships the rest of its chunk", async () => {
    addCard("c1", [{ text: "ok" }, { text: "poison" }, { text: "fine" }] as Partial<ThreadItem>[]);
    const reject: Upsert = (rows) =>
      rows.some((r) => (r.item as { text?: string }).text === "poison") ? { error: { message: "unsupported Unicode escape sequence", code: "22P05" } } : { error: null };
    const { client, sent } = fakeClient({ cloud_thread_items: reject });
    const { skipped, shipped, left } = await run(itemEntries("c1", 3), client);
    expect(skipped).toEqual({ count: 1, message: "unsupported Unicode escape sequence (card c1, item 1)" });
    expect(shipped).toEqual([1, 1]);
    expect(sent.cloud_thread_items).toHaveLength(4);
    expect(left).toEqual([]);
  });

  it("sends a chunk Cloudflare's WAF blocks again with its strings escaped, so the same rows land", async () => {
    addCard("c1", [{ text: "ok" }, { text: "<script>alert(1)</script> SELECT * FROM users" }, { text: "fine" }] as Partial<ThreadItem>[]);
    const { client, sent, bodies } = fakeClient({ cloud_thread_items: (_rows, body) => (body.includes("<script>") ? WAF : { error: null }) });
    const { skipped, shipped, left } = await run(itemEntries("c1", 3), client);
    expect(skipped).toBeNull();
    expect(shipped).toEqual([3]);
    expect(sent.cloud_thread_items).toHaveLength(2);
    expect(bodies.cloud_thread_items![1]).not.toMatch(/[<> *]/);
    expect(JSON.parse(bodies.cloud_thread_items![1]!)).toEqual(JSON.parse(bodies.cloud_thread_items![0]!));
    expect(left).toEqual([]);
  });

  it("skips the one item the WAF blocks even escaped, names it readably, and ships the rest", async () => {
    addCard("c1", [{ text: "ok" }, { text: "poison" }, { text: "fine" }] as Partial<ThreadItem>[]);
    const { client } = fakeClient({ cloud_thread_items: (_rows, body) => (body.includes("poison") ? WAF : { error: null }) });
    const { skipped, shipped, left } = await run(itemEntries("c1", 3), client);
    expect(skipped).toEqual({ count: 1, message: "Cloudflare's firewall blocked an upload to cloud_thread_items (Ray ID a4f0d5779d1bd32a) (card c1, item 1)" });
    expect(shipped).toEqual([1, 1]);
    expect(left).toEqual([]);
  });

  it("sends cards one at a time when the WAF blocks a chunk even escaped, and fails readably on the one it matches", async () => {
    addCard("c1", [{}]);
    addCard("c2", [{}]);
    cards.get("c2")!.title = "poison";
    const { client, sent } = fakeClient({ cloud_cards: (_rows, body) => (body.includes("poison") ? WAF : { error: null }) });
    await expect(run([...itemEntries("c1", 1), ...itemEntries("c2", 1)], client)).rejects.toThrow(/^Cloudflare's firewall blocked an upload to cloud_cards \(Ray ID a4f0d5779d1bd32a\)$/);
    expect(sent.cloud_cards!.map((rows) => rows.map((r) => r.card_id))).toEqual([["c1", "c2"], ["c1", "c2"], ["c1"], ["c2"], ["c2"]]);
  });

  it("does not skip rows for an error that isn't about the data, such as row-level security or a dead connection", async () => {
    addCard("c1", [{}, {}]);
    const { client } = fakeClient({ cloud_thread_items: () => ({ error: { message: "new row violates row-level security policy", code: "42501" } }) });
    const { appendOutbox, readOutbox } = await import("./cloud-outbox");
    const { uploadPending } = await import("./cloud-sync-upload");
    appendOutbox(itemEntries("c1", 2));
    await expect(uploadPending({ blobs, now: () => 5000 }, client, "o1", itemEntries("c1", 2), () => {})).rejects.toThrow("row-level security");
    expect(readOutbox()).toHaveLength(2);
  });

  it("sends a long tool result to cloud_tool_outputs and a card_deleted/truncate through their own calls", async () => {
    addCard("c1", [{ kind: "tool", id: "t1", name: "Read", result: "x".repeat(5000) }]);
    const { client, sent } = fakeClient();
    const { shipped, left } = await run(
      [
        { op: "truncate", cardId: "c1", seq: 5, at: 1 },
        { op: "card_deleted", cardId: "gone", at: 1 },
        ...itemEntries("c1", 1),
      ],
      client,
    );
    expect(sent.cloud_tool_outputs![0]![0]).toMatchObject({ tool_id: "t1", bytes: 5000 });
    expect(shipped).toEqual([1]);
    expect(left).toEqual([]);
  });

  it("sends one tool output per tool id in a request, the latest, when a thread reuses an id", async () => {
    const tool = (result: string) => ({ kind: "tool", id: "item_1", name: "Bash", result });
    addCard("c1", [tool("a".repeat(3000)), { text: "between" }, tool("b".repeat(4000))]);
    const { client, sent } = fakeClient();
    await run(itemEntries("c1", 3), client);
    expect(sent.cloud_tool_outputs).toHaveLength(1);
    expect(sent.cloud_tool_outputs![0]).toHaveLength(1);
    expect(sent.cloud_tool_outputs![0]![0]).toMatchObject({ tool_id: "item_1", bytes: 4000 });
    expect(sent.cloud_thread_items![0]).toHaveLength(3);
  });

  it("consumes entries whose card or item is gone without sending them", async () => {
    addCard("c1", [{}]);
    const { client, sent } = fakeClient();
    const { shipped, left } = await run([...itemEntries("c1", 1), { op: "item", cardId: "c1", seq: 9, at: 1 }, { op: "item", cardId: "nope", seq: 0, at: 1 }], client);
    expect(shipped).toEqual([1]);
    expect(sent.cloud_thread_items).toHaveLength(1);
    expect(left).toEqual([]);
  });
});
