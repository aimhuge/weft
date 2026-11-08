import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { BoardEvent, Card, ThreadItem } from "./types";
import type { BlobStore, CloudCardRow, CloudThreadItemRow, CloudToolOutputRow, OutboxEntry } from "./cloud-sync-types";

const g = globalThis as unknown as Record<string, unknown>;
const cards = new Map<string, Card>();
const threads = new Map<string, ThreadItem[]>();
const settings: { syncFolders: string[] } = { syncFolders: ["/sync"] };

vi.mock("./store", () => ({
  getCard: (id: string) => cards.get(id),
  getThread: (id: string) => threads.get(id) ?? [],
  listCards: () => [...cards.values()],
  // Use a getter so DATA_DIR is read fresh on every access — the vi.mock factory
  // is only called once, but each test gets its own WEFT_DATA temp dir.
  get DATA_DIR() { return process.env.WEFT_DATA; },
}));
vi.mock("./settings", () => ({ syncFolders: () => [...settings.syncFolders] }));
// What accountClient() does when startCloudSync gets no client: return the fake, or throw like a build with no accounts.
const account: { client: () => unknown } = { client: () => null };
vi.mock("./account", () => ({ accountClient: () => account.client() }));

const busListeners = new Set<(e: BoardEvent) => void>();
vi.mock("./bus", () => ({
  subscribe: (l: (e: BoardEvent) => void) => {
    busListeners.add(l);
    return () => busListeners.delete(l);
  },
  publish: (e: BoardEvent) => busListeners.forEach((l) => l(e)),
}));

const writesByTable: Record<string, unknown[][]> = {};
const rowsByTable: Record<string, unknown[]> = {};
const errorsByTable: Record<string, { message: string } | null> = {};
const authSession: { id: string } = { id: "u1" };

function makeClient() {
  return {
    from(table: string) {
      const err = errorsByTable[table] ?? null;
      const rows = rowsByTable[table] ?? [];
      const writes = (writesByTable[table] ??= []);
      const chain: Record<string, unknown> = { __table: table };
      const terminator = (method: string) => (...args: unknown[]) => {
        writes.push(args);
        if (method === "upsert" || method === "insert" || method === "update" || method === "delete") chain.__write = true;
        return chain;
      };
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.gte = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.maybeSingle = () => chain;
      chain.upsert = terminator("upsert");
      chain.insert = terminator("insert");
      chain.update = terminator("update");
      chain.delete = terminator("delete");
      Object.defineProperty(chain, "then", {
        value: (resolve: (v: unknown) => void) => {
          void Promise.resolve(chain.__write ? { data: null, error: err } : { data: rows[0] ?? null, error: err, count: rows.length }).then(resolve);
        },
        configurable: true,
      });
      return chain;
    },
    auth: { getSession: vi.fn(() => Promise.resolve({ data: { session: authSession.id ? { user: authSession } : null } })) },
  };
}

let blobsRewrite: (item: ThreadItem, orgId: string) => Promise<ThreadItem> = (item) => Promise.resolve(item);
const blobs: BlobStore = {
  refFor: vi.fn(() => Promise.resolve(null)),
  upload: vi.fn(() => Promise.resolve(null)),
  rewriteItem: (item, orgId) => blobsRewrite(item, orgId),
};

function cardInStore(id: string, over: Partial<Card> = {}): Card {
  const c: Card = {
    id, title: id, prompt: "", cwd: "/sync", backend: "claude", permissionMode: "default",
    column: "review", createdAt: 0, updatedAt: 0, ...over,
  };
  cards.set(id, c);
  threads.set(id, threads.get(id) ?? []);
  return c;
}

let now = 1000;
const NOW = () => now;
let dir: string;
let stop: (() => void) | null = null;
let warnSpy: MockInstance<typeof console.warn>;
let fakeClient: ReturnType<typeof makeClient>;
let clientProvider: () => ReturnType<typeof makeClient> | null = () => fakeClient;

function resetState() {
  for (const key of Object.keys(writesByTable)) writesByTable[key] = [];
  rowsByTable.org_memberships = [{ org_id: "o1" }];
  for (const key of Object.keys(errorsByTable)) errorsByTable[key] = null;
  errorsByTable.cloud_cards = null;
  errorsByTable.cloud_thread_items = null;
  errorsByTable.cloud_tool_outputs = null;
  authSession.id = "u1";
  now = 1000;
  blobsRewrite = (item: ThreadItem) => Promise.resolve(item);
  fakeClient = makeClient();
  clientProvider = () => fakeClient;
  // The cloud-sync state lives on globalThis (globalSingleton). Clear it so each test gets a fresh one.
  delete g.__weftCloudSync;
}

beforeEach(() => {
  vi.resetModules();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-cloud-sync-"));
  process.env.WEFT_DATA = dir;
  cards.clear();
  threads.clear();
  busListeners.clear();
  settings.syncFolders = ["/sync"];
  resetState();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.useFakeTimers();
});

afterEach(() => {
  if (stop) { stop(); stop = null; }
  vi.useRealTimers();
  warnSpy.mockRestore();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function start() {
  const mod = await import("./cloud-sync");
  stop = mod.startCloudSync({ blobs, client: clientProvider as never, now: NOW });
}

function publish(e: BoardEvent) {
  busListeners.forEach((l) => l(e));
}

async function flush() {
  for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
}

// The fake client pushes the full args array on every terminator call. Pull out the first
// row of the first upsert/update call for a table, or undefined if the table was never written.
function firstWrite(table: string): unknown {
  const writes = writesByTable[table];
  if (!writes) return undefined;
  for (const args of writes) {
    const first = args[0];
    if (Array.isArray(first) && first.length) return first[0];
    if (first && typeof first === "object" && !Array.isArray(first)) return first;
  }
  return undefined;
}

function allRows(table: string): unknown[] {
  const writes = writesByTable[table];
  if (!writes) return [];
  const out: unknown[] = [];
  for (const args of writes) {
    const first = args[0];
    if (Array.isArray(first)) {
      for (const row of first) out.push(row);
    }
  }
  return out;
}

async function outboxEntries(): Promise<OutboxEntry[]> {
  const { readOutbox } = await import("./cloud-outbox");
  return readOutbox();
}

describe("startCloudSync", () => {
  it("ignores bus events for cards outside the synced folder", async () => {
    cardInStore("a", { cwd: "/elsewhere" });
    await start();
    publish({ type: "card", card: cards.get("a")! });
    await flush();
    expect(writesByTable.cloud_cards ?? []).toHaveLength(0);
  });

  it("ignores bus events when no folder is in syncFolders", async () => {
    cardInStore("a");
    settings.syncFolders = [];
    await start();
    publish({ type: "card", card: cards.get("a")! });
    await flush();
    expect(writesByTable.cloud_cards ?? []).toHaveLength(0);
  });

  it("upserts the cloud_cards row from the live store state, not the event payload", async () => {
    const live = cardInStore("a", { title: "live" });
    await start();
    publish({ type: "card", card: { ...live, title: "stale" } });
    await flush();
    const row = firstWrite("cloud_cards") as CloudCardRow | undefined;
    expect(row).toBeDefined();
    expect(row!.card_id).toBe("a");
    expect(row!.card.title).toBe("live");
    expect(row!.deleted).toBe(false);
    expect(row!.folder).toBe("/sync");
  });

  it("marks cloud_cards.deleted=true for a card_deleted event", async () => {
    cardInStore("a", { title: "alive" });
    await start();
    publish({ type: "card", card: cards.get("a")! });
    await flush();
    // The card is still in the store; the delete update marks the row deleted without removing the card.
    publish({ type: "card_deleted", id: "a" });
    await flush();
    const writes = writesByTable.cloud_cards ?? [];
    // Find the update call (object with deleted key, not the array of card rows).
    const update = writes.find((args) => args[0] && typeof args[0] === "object" && !Array.isArray(args[0]) && "deleted" in args[0]) as [{ deleted: boolean; updated_at: string }] | undefined;
    expect(update).toBeDefined();
    expect(update![0].deleted).toBe(true);
    expect(typeof update![0].updated_at).toBe("string");
  });

  it("a card_deleted event for a missing card stays a delete with no card row upsert", async () => {
    // No card in the store; the upsert path is skipped (no cardRows entry), but the delete update still runs.
    await start();
    publish({ type: "card_deleted", id: "ghost" });
    await flush();
    const rows = allRows("cloud_cards") as { card_id?: string }[];
    const hasUpsert = rows.some((r) => r.card_id === "ghost");
    expect(hasUpsert).toBe(false);
    const writes = writesByTable.cloud_cards ?? [];
    const update = writes.find((args) => args[0] && typeof args[0] === "object" && !Array.isArray(args[0]) && "deleted" in args[0]) as [{ deleted: boolean }] | undefined;
    expect(update?.[0].deleted).toBe(true);
  });

  it("uploads items rewritten through the blob store", async () => {
    cardInStore("a");
    const item: ThreadItem = { kind: "result", text: "hi", isError: false, at: 1 };
    threads.set("a", [item]);
    const rewritten: ThreadItem = { kind: "result", text: "hi [blob]", isError: false, at: 1 };
    blobsRewrite = (it) => Promise.resolve(it === item ? rewritten : it);
    await start();
    publish({ type: "thread", cardId: "a", item, index: 0 });
    await flush();
    const row = firstWrite("cloud_thread_items") as CloudThreadItemRow | undefined;
    expect(row).toBeDefined();
    expect(row!.card_id).toBe("a");
    expect(row!.seq).toBe(0);
    expect(row!.item).toEqual(rewritten);
  });

  it("a card referenced only by item entries still gets a cloud_cards row", async () => {
    cardInStore("a", { title: "from-items" });
    const item: ThreadItem = { kind: "result", text: "hi", isError: false, at: 1 };
    threads.set("a", [item]);
    await start();
    // Only a thread event — no separate "card" event for this card.
    publish({ type: "thread", cardId: "a", item, index: 0 });
    await flush();
    const cardRow = firstWrite("cloud_cards") as CloudCardRow | undefined;
    expect(cardRow).toBeDefined();
    expect(cardRow!.card_id).toBe("a");
    expect(cardRow!.card.title).toBe("from-items");
    const itemRow = firstWrite("cloud_thread_items") as CloudThreadItemRow | undefined;
    expect(itemRow).toBeDefined();
    expect(itemRow!.card_id).toBe("a");
  });

  it("splits a long tool result into cloud_tool_outputs and omits it from the item", async () => {
    cardInStore("a");
    const long = "x".repeat(3000);
    const tool: ThreadItem = { kind: "tool", id: "t1", name: "Bash", summary: "run", result: long, at: 2 };
    threads.set("a", [tool]);
    await start();
    publish({ type: "thread", cardId: "a", item: tool, index: 0 });
    // The tool item is not a `result` so the flush waits for the 10s tick. A timeout set inside the tick lands
    // 1 ms later under fake timers, so step past it.
    await vi.advanceTimersByTimeAsync(10_001);
    for (let i = 0; i < 50; i++) await vi.advanceTimersByTimeAsync(0);
    const out = firstWrite("cloud_tool_outputs") as CloudToolOutputRow | undefined;
    expect(out).toBeDefined();
    expect(out!.card_id).toBe("a");
    expect(out!.tool_id).toBe("t1");
    expect(out!.bytes).toBe(3000);
    expect(out!.result).toBe(long);
    const itemRow = firstWrite("cloud_thread_items") as CloudThreadItemRow | undefined;
    expect(itemRow).toBeDefined();
    expect(itemRow!.item).toMatchObject({ kind: "tool", resultBytes: 3000 });
    expect(itemRow!.item).not.toHaveProperty("result");
  });

  it("a truncate thread event queues a truncate + item and the flush issues a delete gte seq", async () => {
    cardInStore("a");
    const item: ThreadItem = { kind: "result", text: "0", isError: false, at: 1 };
    threads.set("a", [item]);
    await start();
    publish({ type: "thread", cardId: "a", item, index: 0, truncate: true });
    await flush();
    // The truncate op calls .delete().eq().gte() on cloud_thread_items; the terminator records the delete call.
    const writes = writesByTable.cloud_thread_items ?? [];
    expect(writes.length).toBeGreaterThan(0);
    // The outbox is empty because the truncate and item both shipped.
    expect(await outboxEntries()).toEqual([]);
  });

  it("a `result` thread item triggers a flush; the next run picks up everything that landed", async () => {
    cardInStore("a");
    const resultItem: ThreadItem = { kind: "result", text: "done", isError: false, at: 5 };
    threads.set("a", [resultItem]);
    await start();
    publish({ type: "thread", cardId: "a", item: resultItem, index: 0 });
    await flush();
    const rows = allRows("cloud_thread_items") as CloudThreadItemRow[];
    expect(rows).toHaveLength(1);
  });

  it("a turn's other items gather for a second, then go up together", async () => {
    cardInStore("a");
    const assistant: ThreadItem = { kind: "assistant", text: "hi", at: 1 };
    const tool: ThreadItem = { kind: "tool", id: "t1", name: "Bash", summary: "ls", at: 2 };
    threads.set("a", [assistant, tool]);
    await start();
    publish({ type: "thread", cardId: "a", item: assistant, index: 0 });
    await vi.advanceTimersByTimeAsync(600);
    // A second item doesn't push the flush back.
    publish({ type: "thread", cardId: "a", item: tool, index: 1 });
    await vi.advanceTimersByTimeAsync(100);
    expect(allRows("cloud_thread_items")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(400);
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
    expect(allRows("cloud_thread_items")).toHaveLength(2);
  });

  it("a message you sent goes up at once", async () => {
    cardInStore("a");
    const user: ThreadItem = { kind: "user", text: "go", at: 1 };
    threads.set("a", [user]);
    await start();
    publish({ type: "thread", cardId: "a", item: user, index: 0 });
    await flush();
    expect(allRows("cloud_thread_items")).toHaveLength(1);
  });

  it("the 10s tick triggers a flush when there are pending entries", async () => {
    cardInStore("a");
    await start();
    // Append directly to the outbox (bypassing the listener) to simulate a card the listener ignored
    // because the folder wasn't yet in syncFolders but the user just turned it on.
    const { appendOutbox, readOutbox } = await import("./cloud-outbox");
    appendOutbox([{ op: "card", cardId: "a", at: 1 } satisfies OutboxEntry]);
    expect(readOutbox()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_001);
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
    expect(allRows("cloud_cards")).toHaveLength(1);
  });

  it("a second trigger while a flush is in flight just sets dirty and runs one follow-up flush", async () => {
    cardInStore("a");
    const resultItem: ThreadItem = { kind: "result", text: "done", isError: false, at: 5 };
    // A result, so it triggers (and finds the first flush in flight) rather than waiting for the tick.
    const secondItem: ThreadItem = { kind: "result", text: "second", isError: false, at: 6 };
    threads.set("a", [resultItem, secondItem]);
    // Hold only the first upload's rewrite; later flushes go straight through.
    let resolveRewrite: (v: ThreadItem) => void = () => {};
    let held = false;
    blobsRewrite = (item) => {
      if (held) return Promise.resolve(item);
      held = true;
      return new Promise<ThreadItem>((resolve) => (resolveRewrite = resolve));
    };
    await start();
    publish({ type: "thread", cardId: "a", item: resultItem, index: 0 });
    await vi.advanceTimersByTimeAsync(0);
    publish({ type: "thread", cardId: "a", item: secondItem, index: 1 });
    resolveRewrite(resultItem);
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
    const seqs = (allRows("cloud_thread_items") as CloudThreadItemRow[]).map((r) => r.seq).sort((a, b) => a - b);
    expect(seqs).toEqual([0, 1]);
  });

  it("an item that lands mid-flush goes up right after it, without waiting the second", async () => {
    cardInStore("a");
    const resultItem: ThreadItem = { kind: "result", text: "done", isError: false, at: 5 };
    const assistant: ThreadItem = { kind: "assistant", text: "more", at: 6 };
    threads.set("a", [resultItem, assistant]);
    let resolveRewrite: (v: ThreadItem) => void = () => {};
    let held = false;
    blobsRewrite = (item) => {
      if (held) return Promise.resolve(item);
      held = true;
      return new Promise<ThreadItem>((resolve) => (resolveRewrite = resolve));
    };
    await start();
    publish({ type: "thread", cardId: "a", item: resultItem, index: 0 });
    await vi.advanceTimersByTimeAsync(0);
    publish({ type: "thread", cardId: "a", item: assistant, index: 1 });
    resolveRewrite(resultItem);
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
    expect(allRows("cloud_thread_items")).toHaveLength(2);
  });

  it("backs off on error and warns once per streak (resets on success)", async () => {
    cardInStore("a");
    await start();
    errorsByTable.cloud_cards = { message: "boom" };
    publish({ type: "card", card: cards.get("a")! });
    await flush();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // A second failure while still in the streak should not warn again.
    publish({ type: "card", card: cards.get("a")! });
    await flush();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // Recover: the next success resets the streak; a later failure warns again.
    errorsByTable.cloud_cards = null;
    publish({ type: "card", card: cards.get("a")! });
    await flush();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    errorsByTable.cloud_cards = { message: "boom2" };
    publish({ type: "card", card: cards.get("a")! });
    await flush();
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("backoff doubles on consecutive failures and caps at 5 minutes", async () => {
    cardInStore("a");
    await start();
    errorsByTable.cloud_cards = { message: "boom" };
    // The first failure: backoff starts at 1_000ms.
    publish({ type: "card", card: cards.get("a")! });
    await vi.advanceTimersByTimeAsync(0);
    expect((g.__weftCloudSync as { backoffMs: number }).backoffMs).toBe(1000);
    // Advance by 1s to fire the backoff timer; second failure doubles to 2_000ms.
    await vi.advanceTimersByTimeAsync(1000);
    expect((g.__weftCloudSync as { backoffMs: number }).backoffMs).toBe(2000);
    // Advance by 2s; third failure → 4_000ms.
    await vi.advanceTimersByTimeAsync(2000);
    expect((g.__weftCloudSync as { backoffMs: number }).backoffMs).toBe(4000);
    // 4s → 8_000ms.
    await vi.advanceTimersByTimeAsync(4000);
    expect((g.__weftCloudSync as { backoffMs: number }).backoffMs).toBe(8000);
    // 8s → 16_000ms.
    await vi.advanceTimersByTimeAsync(8000);
    expect((g.__weftCloudSync as { backoffMs: number }).backoffMs).toBe(16000);
  });

  it("backoff caps at 5 minutes (300_000ms)", async () => {
    cardInStore("a");
    await start();
    errorsByTable.cloud_cards = { message: "boom" };
    publish({ type: "card", card: cards.get("a")! });
    await vi.advanceTimersByTimeAsync(0);
    // Drive many backoff cycles by repeated failures, capped.
    let last = 0;
    for (let i = 0; i < 20; i++) {
      const cur = (g.__weftCloudSync as { backoffMs: number }).backoffMs;
      last = cur;
      // Advance just past the current backoff so the next flush fires.
      await vi.advanceTimersByTimeAsync(cur + 1);
    }
    expect(last).toBe(5 * 60 * 1000);
  });

  it("signed out (no client): keeps entries, doesn't back off, doesn't warn", async () => {
    cardInStore("a");
    clientProvider = () => null;
    await start();
    publish({ type: "card", card: cards.get("a")! });
    await flush();
    expect(allRows("cloud_cards")).toHaveLength(0);
    expect(warnSpy).not.toHaveBeenCalled();
    // The outbox file still holds the entry; the next sign-in flush will pick it up.
    expect((await outboxEntries()).length).toBe(1);
  });

  it("uploads after you sign in: a signed-out flush doesn't leave the outbox stuck in flight", async () => {
    cardInStore("a");
    cardInStore("b");
    let signedIn = false;
    clientProvider = () => (signedIn ? fakeClient : null);
    await start();
    publish({ type: "card", card: cards.get("a")! });
    await flush();
    expect(allRows("cloud_cards")).toHaveLength(0);
    signedIn = true;
    publish({ type: "card", card: cards.get("b")! });
    await flush();
    expect(allRows("cloud_cards").map((r) => (r as { card_id: string }).card_id).sort()).toEqual(["a", "b"]);
  });

  it("no user (session null): keeps entries, doesn't back off, doesn't warn", async () => {
    cardInStore("a");
    fakeClient.auth.getSession.mockResolvedValueOnce({ data: { session: null } });
    await start();
    publish({ type: "card", card: cards.get("a")! });
    await flush();
    expect(allRows("cloud_cards")).toHaveLength(0);
    expect(warnSpy).not.toHaveBeenCalled();
    expect((await outboxEntries()).length).toBe(1);
  });

  it("no workspace: keeps entries, doesn't back off, doesn't warn", async () => {
    rowsByTable.org_memberships = [];
    cardInStore("a");
    await start();
    publish({ type: "card", card: cards.get("a")! });
    await flush();
    expect(allRows("cloud_cards")).toHaveLength(0);
    expect(warnSpy).not.toHaveBeenCalled();
    expect((await outboxEntries()).length).toBe(1);
  });

  it("org lookup error: counts as a failure, warns once, backs off, keeps entries", async () => {
    cardInStore("a");
    errorsByTable.org_memberships = { message: "memberships unavailable" };
    await start();
    publish({ type: "card", card: cards.get("a")! });
    await flush();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(allRows("cloud_cards")).toHaveLength(0);
    expect((g.__weftCloudSync as { backoffMs: number }).backoffMs).toBe(1000);
    expect((await outboxEntries()).length).toBe(1);
  });

  it("compacts the outbox file while signed out (duplicate items → file shrinks)", async () => {
    cardInStore("a");
    clientProvider = () => null;
    await start();
    // Two duplicate item entries (same card+seq) → compaction keeps one item.
    const item1: ThreadItem = { kind: "result", text: "x", isError: false, at: 1 };
    const item2: ThreadItem = { kind: "result", text: "x", isError: false, at: 2 };
    threads.set("a", [item1]);
    publish({ type: "thread", cardId: "a", item: item1, index: 0 });
    publish({ type: "thread", cardId: "a", item: item2, index: 0 });
    await flush();
    // After compaction the file is shorter than the raw writes.
    expect((await outboxEntries()).length).toBe(1);
  });

  it("a mid-upload append for the same card+seq is NOT dropped by the ack", async () => {
    cardInStore("a");
    const first: ThreadItem = { kind: "result", text: "first", isError: false, at: 1 };
    const second: ThreadItem = { kind: "result", text: "second", isError: false, at: 2 };
    threads.set("a", [first]);
    // Hold only the first upload's rewrite; later flushes go straight through.
    let resolveRewrite: (v: ThreadItem) => void = () => {};
    let held = false;
    blobsRewrite = (item) => {
      if (held) return Promise.resolve(item);
      held = true;
      return new Promise<ThreadItem>((resolve) => (resolveRewrite = resolve));
    };
    await start();
    // First event triggers the flush; the rewrite is held.
    publish({ type: "thread", cardId: "a", item: first, index: 0 });
    await vi.advanceTimersByTimeAsync(0);
    // Mid-flush, the item at seq 0 changes and a newer entry for the same (card, seq) lands. The ack must keep it.
    threads.set("a", [second]);
    publish({ type: "thread", cardId: "a", item: second, index: 0 });
    // Let the first flush complete; the second flush will be triggered by dirty.
    resolveRewrite(first);
    for (let i = 0; i < 50; i++) await vi.advanceTimersByTimeAsync(0);
    // The outbox is empty because the second flush also succeeded and shipped the second entry.
    expect((await outboxEntries()).length).toBe(0);
    const texts = (allRows("cloud_thread_items") as CloudThreadItemRow[]).map((r) => (r.item as { text?: string }).text);
    // The second event's text is what got uploaded (newer wins on dedupe by at).
    expect(texts).toContain("second");
  });

  it("switching user ids looks up the org again (the orgs cache is per-user)", async () => {
    cardInStore("a");
    // First user: u1 with org o1.
    rowsByTable.org_memberships = [{ org_id: "o1" }];
    authSession.id = "u1";
    await start();
    publish({ type: "card", card: cards.get("a")! });
    await flush();
    // Cached: orgs[u1] = o1.
    const state = g.__weftCloudSync as { orgs: Map<string, string | null> };
    expect(state.orgs.get("u1")).toBe("o1");
    // Switch to u2 with org o2; the lookup must hit the network, not the cache.
    authSession.id = "u2";
    rowsByTable.org_memberships = [{ org_id: "o2" }];
    publish({ type: "card", card: cards.get("a")! });
    await flush();
    expect(state.orgs.get("u2")).toBe("o2");
    // The card row uploaded for u2 has org_id o2.
    const cardRows2 = allRows("cloud_cards") as CloudCardRow[];
    const lastCard = cardRows2[cardRows2.length - 1];
    expect(lastCard!.org_id).toBe("o2");
  });

  it("stop() unsubscribes and stops the 10s tick", async () => {
    cardInStore("a");
    await start();
    stop!();
    publish({ type: "card", card: cards.get("a")! });
    await vi.advanceTimersByTimeAsync(11_000);
    expect(allRows("cloud_cards")).toHaveLength(0);
  });

  it("uses the account's client when none is passed", async () => {
    cardInStore("a");
    account.client = () => fakeClient;
    const mod = await import("./cloud-sync");
    stop = mod.startCloudSync({ blobs, now: NOW });
    publish({ type: "card", card: cards.get("a")! });
    await flush();
    expect(allRows("cloud_cards")).toHaveLength(1);
  });

  it("treats a build with no accounts as signed out and keeps the entries", async () => {
    cardInStore("a");
    account.client = () => {
      throw new Error("Weft accounts aren't set up in this build yet.");
    };
    const mod = await import("./cloud-sync");
    stop = mod.startCloudSync({ blobs, now: NOW });
    publish({ type: "card", card: cards.get("a")! });
    await flush();
    expect(allRows("cloud_cards")).toHaveLength(0);
    expect(await outboxEntries()).toHaveLength(1);
  });
});

// Tests for the public cloudSyncStatus / syncNow / queueFolder APIs live in cloud-sync-public.test.ts.
