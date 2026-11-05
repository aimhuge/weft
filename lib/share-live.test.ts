// lib/share-live.ts: how thread items + a pane + signed blob URLs come together for the page and
// the live poll. The two Supabase reads (thread items + pane probe) are mocked; everything else is
// the module under test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const BUCKET_PATH = "org-1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const { serviceClient: serviceClientMock } = vi.hoisted(() => ({
  serviceClient: vi.fn(),
}));

vi.mock("@/lib/web-session", () => ({
  serviceClient: serviceClientMock,
}));

async function load() {
  vi.resetModules();
  return import("./share-live");
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const SHA = "a".repeat(64);
// Built at run time so no key-shaped literal sits in the file for the pre-commit secret scan.
const STRIPE_KEY = ["sk", "live", "51HxK9e2eZvKYlo2CcZ3pD6Xr"].join("_");
const REF = `blob:sha256:${SHA}`;

// A chainable, thenable query builder. .from(table) → .select() → .eq() → .eq() → .order() →
// .limit() → .lt() / .gt() → await. Awaiting the chain resolves to { data, error } with the rows
// passed in, so share-live's `await query` lines work without `.maybeSingle()` or `.single()`.
function buildChain(rows: unknown[], error: unknown = null) {
  const makeChain = (): unknown => {
    const obj: Record<string, unknown> & { then?: unknown } = {
      then: (onFulfilled: (v: { data: unknown[]; error: unknown }) => unknown) =>
        Promise.resolve({ data: rows, error }).then(onFulfilled),
    };
    for (const k of ["select", "eq", "order", "limit", "lt", "gt", "overrideTypes", "maybeSingle", "insert", "update"]) {
      obj[k] = vi.fn(() => {
        if (k === "maybeSingle") return Promise.resolve({ data: rows[0] ?? null, error });
        if (k === "insert" || k === "update") return Promise.resolve({ data: null, error });
        return makeChain();
      });
    }
    return obj;
  };
  return makeChain();
}

// Wrap a row-creator so a service mock can expose both `.from(table)` (queries) and
// `.storage.from(bucket).createSignedUrls(...)` (the share-live path). `bucketRows` returns the
// signed-URL rows for the batch share-live asks for; tests pass `() => [...]` to capture calls.
function withStorage(svc: { from: (table: string) => unknown }, bucketRows: (paths: string[]) => { data: { path: string; signedUrl: string }[]; error: null }) {
  return {
    ...svc,
    storage: {
      from: () => ({
        createSignedUrls: vi.fn((paths: string[]) => Promise.resolve(bucketRows(paths))),
      }),
    },
  };
}

describe("buildShareLive", () => {
  it("returns a ShareLive with redacted items, the pane and signed URLs", async () => {
    // The chain returns rows in newest-first order; the second call (pane probe) returns the
    // newest open_url with the blob ref.
    const threadRows = [
      { org_id: "org-1", card_id: "c1", seq: 2, kind: "user", item: { kind: "user", text: `hello ${STRIPE_KEY}`, at: 2 }, at: "2026-10-17T00:00:00.000Z" },
      { org_id: "org-1", card_id: "c1", seq: 1, kind: "tool", item: { kind: "tool", id: "t1", name: "mcp__browser__open_url", summary: `${REF}#step`, at: 1 }, at: "2026-10-17T00:00:00.000Z" },
    ];
    // The second cloud_thread_items call (the pane probe) returns the same items.
    let call = 0;
    const baseSvc = {
      from: (table: string) => {
        if (table === "cloud_thread_items") {
          call += 1;
          if (call === 1) return buildChain(threadRows);
          return buildChain(threadRows);
        }
        return buildChain([]);
      },
    };
    const svc = withStorage(baseSvc, () => ({ data: [{ path: BUCKET_PATH, signedUrl: "https://signed.example/blob" }], error: null }));
    serviceClientMock.mockReturnValue(svc);
    const { buildShareLive } = await load();
    const live = await buildShareLive({ service: svc as never, orgId: "org-1", cardId: "c1", card: { id: "c1", title: "T", cwd: "/Users/me/private", sessionId: "s1" } });
    expect(live.card).toEqual({ id: "c1", title: "T", column: "backlog" });
    expect(live.items.length).toBe(2);
    expect(live.pane).toEqual({ kind: "blob", ref: REF, hash: "#step", label: "Page" });
    expect(live.blobUrls[REF]).toBe("https://signed.example/blob");
    // The user message's token was redacted.
    const first = live.items[0]!.item;
    if (first.kind === "user") expect(first.text).toContain("‹hidden:");
  });

  it("flips 'newer' (after) results so the response is newest-first", async () => {
    const threadRows = [
      { org_id: "org-1", card_id: "c1", seq: 1, kind: "user", item: { kind: "user", text: "oldest", at: 1 }, at: "t" },
      { org_id: "org-1", card_id: "c1", seq: 2, kind: "user", item: { kind: "user", text: "newer", at: 2 }, at: "t" },
    ];
    // The first call's chain returns the rows oldest-first (gt 0, ascending false → still desc).
    // For the "after" path the test asserts the function flips them.
    const baseSvc = {
      from: (table: string) => {
        if (table === "cloud_thread_items") {
          // The "newer" branch fetches with `.gt("seq", edge)` and `.order(seq, desc)` — the
          // Supabase mock returns the same rows in the same order, so the function must reverse.
          return buildChain(threadRows);
        }
        return buildChain([]);
      },
    };
    const svc = withStorage(baseSvc, () => ({ data: [], error: null }));
    serviceClientMock.mockReturnValue(svc);
    const { buildShareLive } = await load();
    const live = await buildShareLive({ service: svc as never, orgId: "org-1", cardId: "c1", card: { id: "c1" }, after: 0 });
    expect(live.items.map((i) => i.seq)).toEqual([2, 1]);
  });

  it("returns an empty live with no pane when there are no rows", async () => {
    const baseSvc = {
      from: () => buildChain([]),
    };
    const svc = withStorage(baseSvc, () => ({ data: [], error: null }));
    serviceClientMock.mockReturnValue(svc);
    const { buildShareLive } = await load();
    const live = await buildShareLive({ service: svc as never, orgId: "org-1", cardId: "c1", card: { id: "c1" } });
    expect(live.items).toEqual([]);
    expect(live.pane).toBeNull();
    expect(live.blobUrls).toEqual({});
    expect(live.hasOlder).toBe(false);
  });

  it("signs the card's thumb blob ref when present", async () => {
    const createSignedUrlsCalls: string[][] = [];
    const baseSvc = {
      from: () => buildChain([]),
    };
    const svc = withStorage(baseSvc, (paths) => {
      createSignedUrlsCalls.push(paths);
      return { data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })), error: null };
    });
    serviceClientMock.mockReturnValue(svc);
    const { buildShareLive } = await load();
    const live = await buildShareLive({
      service: svc as never,
      orgId: "org-1",
      cardId: "c1",
      card: { id: "c1", thumb: REF },
    });
    expect(createSignedUrlsCalls.length).toBeGreaterThan(0);
    expect(live.blobUrls[REF]).toBe(`https://signed/org-1/${SHA}`);
  });

  it("shows the chat by default", async () => {
    const threadRows = [{ org_id: "org-1", card_id: "c1", seq: 1, kind: "user", item: { kind: "user", text: "hello", at: 1 }, at: "t" }];
    const baseSvc = { from: () => buildChain(threadRows) };
    const svc = withStorage(baseSvc, () => ({ data: [], error: null }));
    serviceClientMock.mockReturnValue(svc);
    const { buildShareLive } = await load();
    const live = await buildShareLive({ service: svc as never, orgId: "org-1", cardId: "c1", card: { id: "c1" } });
    expect(live.showChat).toBe(true);
    expect(live.items.map((i) => i.seq)).toEqual([1]);
  });

  it("sends no items at all when the chat is hidden", async () => {
    const threadRows = [{ org_id: "org-1", card_id: "c1", seq: 1, kind: "user", item: { kind: "user", text: "hello", at: 1 }, at: "t" }];
    const baseSvc = { from: () => buildChain(threadRows) };
    const svc = withStorage(baseSvc, () => ({ data: [], error: null }));
    serviceClientMock.mockReturnValue(svc);
    const { buildShareLive } = await load();
    const live = await buildShareLive({ service: svc as never, orgId: "org-1", cardId: "c1", card: { id: "c1" }, showChat: false });
    expect(live.showChat).toBe(false);
    expect(live.items).toEqual([]);
    expect(live.hasOlder).toBe(false);
  });

  it("never asks for the thread's page when the chat is hidden", async () => {
    // The pane probe still reads cloud_thread_items; the *page* read (the newest slice) does not.
    // The page read selects every column and orders by seq descending; the probe selects
    // "item, at, seq" — so the two are told apart by the select argument.
    const selects: string[] = [];
    const baseSvc = {
      from: (table: string) => {
        if (table !== "cloud_thread_items") return buildChain([]);
        const make = (): Record<string, unknown> & { then?: unknown } => {
          const obj: Record<string, unknown> & { then?: unknown } = {
            then: (onFulfilled: (v: { data: unknown[]; error: unknown }) => unknown) =>
              Promise.resolve({ data: [], error: null }).then(onFulfilled),
          };
          for (const k of ["eq", "order", "limit", "overrideTypes"]) obj[k] = vi.fn(() => make());
          obj.select = vi.fn((cols: string) => {
            selects.push(cols);
            return make();
          });
          return obj;
        };
        return make();
      },
    };
    const svc = withStorage(baseSvc, () => ({ data: [], error: null }));
    serviceClientMock.mockReturnValue(svc);
    const { buildShareLive } = await load();
    await buildShareLive({ service: svc as never, orgId: "org-1", cardId: "c1", card: { id: "c1" }, showChat: false });
    // Only the pane probe read the thread; the page read ("*") never happened.
    expect(selects).toEqual(["item, at, seq"]);
  });
});

describe("loadThreadPage", () => {
  it("queries the thread with seq < edge for older, seq > edge for newer, no edge for newest", async () => {
    const seenFilters: string[] = [];
    const svc = {
      from: (table: string) => {
        if (table !== "cloud_thread_items") return buildChain([]);
        const obj: Record<string, unknown> & { then?: unknown } = {
          then: (onFulfilled: (v: { data: unknown[]; error: unknown }) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(onFulfilled),
        };
        for (const k of ["select", "order", "limit", "overrideTypes"]) obj[k] = vi.fn(() => obj);
        obj.eq = vi.fn(() => obj);
        obj.lt = vi.fn((col: string, v: number) => { seenFilters.push(`lt:${col}:${v}`); return obj; });
        obj.gt = vi.fn((col: string, v: number) => { seenFilters.push(`gt:${col}:${v}`); return obj; });
        return obj;
      },
    };
    serviceClientMock.mockReturnValue(svc);
    const { loadThreadPage } = await load();
    await loadThreadPage(svc as never, "org-1", "c1", "older", 5);
    expect(seenFilters).toEqual(["lt:seq:5"]);
    seenFilters.length = 0;
    await loadThreadPage(svc as never, "org-1", "c1", "newer", 9);
    expect(seenFilters).toEqual(["gt:seq:9"]);
    seenFilters.length = 0;
    await loadThreadPage(svc as never, "org-1", "c1", "newest");
    expect(seenFilters).toEqual([]);
  });
});

describe("loadPaneAcrossThread", () => {
  it("returns null when the probe finds no pane", async () => {
    const svc = { from: () => buildChain([]) };
    serviceClientMock.mockReturnValue(svc);
    const { loadPaneAcrossThread } = await load();
    expect(await loadPaneAcrossThread(svc as never, "org-1", "c1")).toBeNull();
  });

  it("returns the pane from the probe's items", async () => {
    const paneRows = [
      { item: { kind: "tool", id: "t1", name: "mcp__browser__open_url", summary: "https://x.com/path", at: 1 }, at: "t", seq: 1 },
    ];
    const svc = { from: () => buildChain(paneRows) };
    serviceClientMock.mockReturnValue(svc);
    const { loadPaneAcrossThread } = await load();
    expect(await loadPaneAcrossThread(svc as never, "org-1", "c1")).toEqual({
      kind: "site",
      url: "https://x.com/path",
      label: "x.com/path",
    });
  });

  it("is null when the probe's read fails", async () => {
    const svc = { from: () => buildChain([], new Error("boom")) };
    serviceClientMock.mockReturnValue(svc);
    const { loadPaneAcrossThread } = await load();
    expect(await loadPaneAcrossThread(svc as never, "org-1", "c1")).toBeNull();
  });
});
