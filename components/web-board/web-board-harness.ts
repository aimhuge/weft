// Shared by the weft.zip board's component tests: a stand-in for @supabase/ssr's browser client whose
// Realtime handlers a test fires by hand and whose queries answer from `db`, plus card and thread-row builders.
import { forget } from "@/lib/optimistic-cards";
import { vi } from "vitest";
import type { CloudCommandRow } from "@/lib/cloud-commands";
import type { CloudCardRow, CloudThreadItemRow } from "@/lib/cloud-sync-types";
import type { Card, ThreadItem } from "@/lib/types";

// jsdom has no Web Animations; the show rail pulses a mini with one (lib/show-events.ts).
if (typeof Element !== "undefined" && typeof Element.prototype.animate !== "function") Element.prototype.animate = () => ({}) as Animation;

export type Table = "cloud_cards" | "cloud_thread_items" | "cloud_commands";

// What the mocked client answers a query with, by table; a test sets these before it renders.
export const db = {
  items: [] as CloudThreadItemRow[],
  toolOutput: null as string | null,
  signed: {} as Record<string, string>,
  // Why an insert into or delete from cloud_commands fails, or null to let it through.
  insertError: null as string | null,
  deleteError: null as string | null,
  // How a command read back by id went (the web's host verbs follow theirs, lib/cloud-host-acts.ts).
  command: { status: "done", error: null } as { status: string; error: string | null; result?: unknown },
};

// A module-scoped object the mock factory closes over: each created client's Realtime handlers, so a
// test can fire payloads by table name.
export const mockState = {
  clients: [] as Array<{ trigger: (table: Table, payload: unknown) => void }>,
  queries: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
  // What the board wrote: the row of each insert, the filters of each delete.
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  deletes: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
  // What went up to the blob store: its path and type.
  uploads: [] as Array<{ path: string; contentType?: string }>,
};

// db.items as a page query reads them: the card's rows (card_id=), before a seq (seq<), newest first, up to the limit;
// or, past a seq (seq>, find's read), oldest first.
function threadRows(filters: Array<[string, unknown]>, limit: number): CloudThreadItemRow[] {
  const card = filters.find(([k]) => k === "card_id")?.[1];
  const before = filters.find(([k]) => k === "seq<")?.[1] as number | undefined;
  const after = filters.find(([k]) => k === "seq>")?.[1] as number | undefined;
  return db.items
    .filter((r) => (card === undefined || r.card_id === card) && (before === undefined || r.seq < before) && (after === undefined || r.seq > after))
    .toSorted((a, b) => (after === undefined ? b.seq - a.seq : a.seq - b.seq))
    .slice(0, limit);
}

// A chainable stand-in for the query builder: every filter returns it, and awaiting it answers.
function query(table: string) {
  const filters: Array<[string, unknown]> = [];
  mockState.queries.push({ table, filters });
  let deleting = false;
  let inserted: Record<string, unknown> | null = null;
  let limit = Infinity;
  const answer = () => ({ data: table === "cloud_thread_items" ? threadRows(filters, limit) : [], error: deleting && db.deleteError ? { message: db.deleteError } : null });
  const builder: Record<string, unknown> = {
    select: () => builder,
    in: (k: string, v: unknown) => (filters.push([`${k} in`, v]), builder),
    insert: (row: Record<string, unknown>) => {
      inserted = row;
      mockState.inserts.push({ table, row });
      return builder;
    },
    delete: () => {
      deleting = true;
      mockState.deletes.push({ table, filters });
      return builder;
    },
    single: () =>
      Promise.resolve(
        db.insertError
          ? { data: null, error: { message: db.insertError } }
          : { data: { ...inserted, id: "cmd-1", created_by: "u1", status: "pending", card_id: null, error: null, created_at: NOW, updated_at: NOW }, error: null },
      ),
    eq: (k: string, v: unknown) => (filters.push([k, v]), builder),
    lt: (k: string, v: unknown) => (filters.push([`${k}<`, v]), builder),
    gt: (k: string, v: unknown) => (filters.push([`${k}>`, v]), builder),
    order: () => builder,
    limit: (n: number) => ((limit = n), builder),
    overrideTypes: () => builder,
    maybeSingle: () =>
      Promise.resolve(table === "cloud_commands" ? { data: db.command, error: null } : { data: db.toolOutput === null ? null : { result: db.toolOutput }, error: null }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(answer()).then(resolve),
  };
  return builder;
}

export const supabaseSsrMock = {
  createBrowserClient: () => {
    const handlers = new Map<Table, (payload: unknown) => void>();
    const channel = {
      on: (_type: string, cfg: { table: Table }, cb: (payload: unknown) => void) => {
        handlers.set(cfg.table, cb);
        return channel;
      },
      subscribe: (cb: (status: string) => void) => {
        queueMicrotask(() => cb("SUBSCRIBED"));
        return channel;
      },
    };
    mockState.clients.push({ trigger: (table, payload) => handlers.get(table)?.(payload) });
    return {
      channel: () => channel,
      removeChannel: vi.fn().mockResolvedValue(undefined),
      from: (table: string) => query(table),
      storage: {
        from: () => ({
          createSignedUrls: (paths: string[]) =>
            Promise.resolve({ data: paths.map((path) => ({ path, signedUrl: db.signed[path.split("/").pop() ?? ""] ?? null })), error: null }),
          upload: (path: string, _body: unknown, opts: { contentType?: string }) => {
            mockState.uploads.push({ path, contentType: opts.contentType });
            return Promise.resolve({ error: null });
          },
        }),
      },
    };
  },
};

export const supabaseProjectMock = { SUPABASE_URL: "https://test.supabase.co", SUPABASE_KEY: "sb_publishable_test" };


export const NOW = "2026-10-15T12:00:00.000Z";

export function cardRow(over: Partial<{
  card_id: string;
  title: string;
  column: Card["column"];
  folder: string;
  owner_device: string;
  owner_user: string;
  deleted: boolean;
  updated_at: string;
  card: Partial<Card>;
}> = {}): CloudCardRow {
  const folder = over.folder ?? "/Users/me/dev/app";
  const id = over.card_id ?? "c1";
  return {
    org_id: "o1",
    card_id: id,
    owner_device: over.owner_device ?? "mac-1",
    owner_user: over.owner_user ?? "u1",
    folder,
    card: {
      id,
      title: over.title ?? "Card 1",
      prompt: "prompt",
      cwd: folder,
      backend: "claude",
      permissionMode: "auto",
      column: over.column ?? "backlog",
      createdAt: 0,
      updatedAt: 0,
      ...over.card,
    },
    deleted: over.deleted ?? false,
    updated_at: over.updated_at ?? NOW,
  };
}

export function commandRow(over: Partial<CloudCommandRow> = {}): CloudCommandRow {
  return {
    id: "cmd-1",
    org_id: "o1",
    created_by: "u1",
    kind: "new_card",
    target_device: "mac-1",
    folder: "/Users/me/dev/app",
    payload: { prompt: "Add a dark mode" },
    status: "pending",
    card_id: null,
    error: null,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  };
}

export function itemRow(seq: number, item: ThreadItem, card_id = "c1"): CloudThreadItemRow {
  return { org_id: "o1", card_id, seq, kind: item.kind, item, at: NOW };
}


// Back to a clean slate between tests.
export function resetHarness() {
  // What a test drew on a card (a Stop, an answer, a star) stays in lib/optimistic-cards.ts until it settles; the next test starts clean.
  for (const id of ["c1", "c2", "c3"]) forget(id);
  // A reply box's draft is kept in localStorage, which a run shares across files.
  if (typeof localStorage !== "undefined") localStorage.clear();
  mockState.clients.length = 0;
  mockState.queries.length = 0;
  db.items = [];
  db.toolOutput = null;
  db.signed = {};
  db.insertError = null;
  db.deleteError = null;
  db.command = { status: "done", error: null };
  mockState.inserts.length = 0;
  mockState.deletes.length = 0;
  mockState.uploads.length = 0;
}
