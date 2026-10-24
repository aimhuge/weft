import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardEvent, Card, ThreadItem } from "./types";
import type { BlobStore, OutboxEntry } from "./cloud-sync-types";

// The public API the Settings → Sync page polls (lib/use-cloud-sync.ts). These tests share the
// scaffolding with cloud-sync.test.ts — same fakes, same flush helper — so behaviour preserved when
// the implementation changes is asserted in the same shape across both files.

const g = globalThis as unknown as Record<string, unknown>;
const cards = new Map<string, Card>();
const threads = new Map<string, ThreadItem[]>();
const settings: { syncFolders: string[] } = { syncFolders: ["/sync"] };

vi.mock("./store", () => ({
  getCard: (id: string) => cards.get(id),
  getThread: (id: string) => threads.get(id) ?? [],
  listCards: () => [...cards.values()],
  get DATA_DIR() { return process.env.WEFT_DATA; },
}));
vi.mock("./settings", () => ({ syncFolders: () => [...settings.syncFolders] }));
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
const errorsByTable: Record<string, { message: string; code?: string } | null> = {};
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
let fakeClient: ReturnType<typeof makeClient>;
let clientProvider: () => ReturnType<typeof makeClient> | null = () => fakeClient;

function resetState() {
  for (const key of Object.keys(writesByTable)) writesByTable[key] = [];
  rowsByTable.org_memberships = [{ org_id: "o1" }];
  for (const key of Object.keys(errorsByTable)) errorsByTable[key] = null;
  authSession.id = "u1";
  now = 1000;
  blobsRewrite = (item: ThreadItem) => Promise.resolve(item);
  fakeClient = makeClient();
  clientProvider = () => fakeClient;
  delete g.__weftCloudSync;
}

beforeEach(() => {
  vi.resetModules();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-cloud-sync-pub-"));
  process.env.WEFT_DATA = dir;
  cards.clear();
  threads.clear();
  busListeners.clear();
  settings.syncFolders = ["/sync"];
  resetState();
  vi.useFakeTimers();
});

afterEach(() => {
  if (stop) { stop(); stop = null; }
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function start() {
  const mod = await import("./cloud-sync");
  stop = mod.startCloudSync({ blobs, client: clientProvider as never, now: NOW });
}

function publish(e: BoardEvent) {
  busListeners.forEach((l) => l(e));
}

function allRows(table: string): unknown[] {
  const writes = writesByTable[table];
  if (!writes) return [];
  const out: unknown[] = [];
  for (const args of writes) {
    const first = args[0];
    if (Array.isArray(first)) for (const row of first) out.push(row);
  }
  return out;
}

async function outboxEntries(): Promise<OutboxEntry[]> {
  const { readOutbox } = await import("./cloud-outbox");
  return readOutbox();
}

describe("cloudSyncStatus / syncNow / queueFolder", () => {
  it("cloudSyncStatus returns empty values before any flush has run", async () => {
    const mod = await import("./cloud-sync");
    expect(mod.cloudSyncStatus()).toEqual({
      waiting: 0, lastSyncAt: null, uploaded: 0, lastError: null, signedOut: false, noWorkspace: false,
    });
  });

  it("cloudSyncStatus reflects a successful flush", async () => {
    cardInStore("a");
    const resultItem: ThreadItem = { kind: "result", text: "done", isError: false, at: 1 };
    threads.set("a", [resultItem]);
    await start();
    publish({ type: "thread", cardId: "a", item: resultItem, index: 0 });
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
    const mod = await import("./cloud-sync");
    const status = mod.cloudSyncStatus();
    expect(status.waiting).toBe(0);
    expect(status.uploaded).toBe(1);
    expect(status.lastSyncAt).toBe(1000);
    expect(status.lastError).toBeNull();
    expect(status.signedOut).toBe(false);
    expect(status.noWorkspace).toBe(false);
  });

  it("cloudSyncStatus reports signedOut and noWorkspace from the last flush", async () => {
    cardInStore("a");
    const resultItem: ThreadItem = { kind: "result", text: "done", isError: false, at: 1 };
    threads.set("a", [resultItem]);
    // First flush: signed out. The listener captures the null-returning client at start.
    clientProvider = () => null;
    await start();
    publish({ type: "thread", cardId: "a", item: resultItem, index: 0 });
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
    const mod = await import("./cloud-sync");
    expect(mod.cloudSyncStatus().signedOut).toBe(true);
    expect(mod.cloudSyncStatus().noWorkspace).toBe(false);

    // Stop and restart with a fake client but no workspace, then a fresh user id.
    stop!();
    clientProvider = () => fakeClient;
    rowsByTable.org_memberships = [];
    authSession.id = "u-no-org";
    await start();
    publish({ type: "thread", cardId: "a", item: resultItem, index: 0 });
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
    expect(mod.cloudSyncStatus().noWorkspace).toBe(true);
    expect(mod.cloudSyncStatus().signedOut).toBe(false);

    // Stop, give the user a workspace, and start again.
    stop!();
    rowsByTable.org_memberships = [{ org_id: "o1" }];
    authSession.id = "u-yes-org";
    await start();
    publish({ type: "thread", cardId: "a", item: resultItem, index: 0 });
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
    const s = mod.cloudSyncStatus();
    expect(s.noWorkspace).toBe(false);
    expect(s.signedOut).toBe(false);
  });

  it("cloudSyncStatus reports the last error and clears it on the next success", async () => {
    cardInStore("a");
    await start();
    errorsByTable.cloud_cards = { message: "boom" };
    publish({ type: "card", card: cards.get("a")! });
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
    const mod = await import("./cloud-sync");
    expect(mod.cloudSyncStatus().lastError).toBe("boom");

    errorsByTable.cloud_cards = null;
    publish({ type: "card", card: cards.get("a")! });
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
    expect(mod.cloudSyncStatus().lastError).toBeNull();
  });

  it("skips items the server refuses for good, reports them in lastError, and carries on", async () => {
    cardInStore("a");
    threads.set("a", [{ kind: "assistant", text: "x", at: 1 }, { kind: "assistant", text: "y", at: 2 }] as ThreadItem[]);
    await start();
    errorsByTable.cloud_thread_items = { message: "unsupported Unicode escape sequence", code: "22P05" };
    const { appendOutbox } = await import("./cloud-outbox");
    appendOutbox([{ op: "item", cardId: "a", seq: 0, at: 1 }, { op: "item", cardId: "a", seq: 1, at: 1 }]);
    const mod = await import("./cloud-sync");
    mod.syncNow();
    await vi.advanceTimersByTimeAsync(1);
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
    expect(mod.cloudSyncStatus().lastError).toBe("Skipped 2 items the server refused: unsupported Unicode escape sequence (card a, item 1)");
    expect(mod.cloudSyncStatus().waiting).toBe(0);
    expect(mod.cloudSyncStatus().lastSyncAt).not.toBeNull();
  });

  it("syncNow() is a no-op when cloud sync was never started", async () => {
    const mod = await import("./cloud-sync");
    mod.syncNow();
    expect(await outboxEntries()).toEqual([]);
  });

  it("syncNow() flushes the outbox right away, even when it was populated by hand", async () => {
    cardInStore("a");
    await start();
    const { appendOutbox } = await import("./cloud-outbox");
    appendOutbox([{ op: "card", cardId: "a", at: 1 } satisfies OutboxEntry]);
    const mod = await import("./cloud-sync");
    mod.syncNow();
    // A setTimeout(fn, 0) under fake timers needs at least 1ms to fire.
    await vi.advanceTimersByTimeAsync(1);
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
    expect(allRows("cloud_cards")).toHaveLength(1);
  });

  it("queueFolder() is a no-op before cloud sync starts, and ignores folders that aren't on the board", async () => {
    cardInStore("a", { cwd: "/sync" });
    const { readOutbox } = await import("./cloud-outbox");
    const before = readOutbox().length;
    const mod = await import("./cloud-sync");
    mod.queueFolder("/sync");
    expect(readOutbox().length).toBe(before);
    mod.queueFolder("/nowhere");
    expect(readOutbox().length).toBe(before);
  });

  it("queueFolder() appends a card entry per card and an item entry per thread item, then flushes", async () => {
    const a = cardInStore("a", { cwd: "/sync" });
    cardInStore("b", { cwd: "/other" });
    const item1: ThreadItem = { kind: "user", text: "hi", at: 1 };
    const item2: ThreadItem = { kind: "result", text: "done", isError: false, at: 2 };
    threads.set("a", [item1, item2]);
    threads.set("b", [item1]);
    await start();
    const mod = await import("./cloud-sync");
    mod.queueFolder("/sync");
    await vi.advanceTimersByTimeAsync(1);
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
    const rows = allRows("cloud_cards") as { card_id: string }[];
    expect(rows.map((r) => r.card_id)).toEqual([a.id]);
    const itemRows = allRows("cloud_thread_items") as { seq: number }[];
    expect(itemRows.map((r) => r.seq).sort((x, y) => x - y)).toEqual([0, 1]);
    // The other folder wasn't on the outbox and its row never went up.
    expect(rows.some((r) => r.card_id === "b")).toBe(false);
  });

  it("forgetSyncOrg makes the next flush look the workspace up again (after a team is deleted)", async () => {
    cardInStore("a");
    await start();
    publish({ type: "card", card: cards.get("a")! });
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
    rowsByTable.org_memberships = [{ org_id: "o2" }];
    (await import("./cloud-sync")).forgetSyncOrg();
    publish({ type: "card", card: cards.get("a")! });
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
    expect((allRows("cloud_cards") as { org_id: string }[]).map((r) => r.org_id)).toEqual(["o1", "o2"]);
  });
});
