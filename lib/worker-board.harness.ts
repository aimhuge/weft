import type { boardFrom } from "./worker-board";
// The fake Supabase client the worker board's tests share (lib/worker-board.test.ts). It answers the tables
// lib/worker-board.ts reads, and records what was asked for. Each from() gets its own builder, as the real
// client does: two queries read at once (the workers and the folders they report) each answer on their own
// terms.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface FakeOptions {
  user?: string | null;
  // cloud_workers rows (the list your workers comes from).
  workers?: unknown[] | null;
  // cloud_workers rows with a folders column (the reported folders read).
  folderRows?: unknown[] | null;
  // cloud_cards rows.
  cards?: unknown[] | null;
  // cloud_thread_items rows.
  items?: unknown[] | null;
  // cloud_tool_outputs row.
  toolOutput?: { result: string } | null;
  // A card row for the command target lookup.
  cardRow?: { owner_device: string; owner_worker: string | null; folder: string; owner_user: string } | null;
  workersError?: { message: string } | null;
  cardsError?: { message: string } | null;
  itemsError?: { message: string } | null;
  // The newest item's seq, which an empty `after` read asks for.
  head?: unknown[] | null;
  headError?: { message: string } | null;
  toolError?: { message: string } | null;
  insertId?: string;
  insertError?: { message: string } | null;
  // What the blobs bucket answers an upload with.
  uploadError?: { message: string } | null;
  // The worker's published key, for a sealed offer (a cloud_workers maybeSingle).
  publicKey?: string | null;
}

// The rows a table answers with. `columns` is the select being read, so one table can answer each query on
// its own terms.
const rows = (value: unknown, error: { message: string } | null = null) => ({ data: value, error });

// The value a table answers with when the test named none.
const or = <T>(value: T | null | undefined, fallback: T): T => (value === null || value === undefined ? fallback : value);

// The error a table answers with when the test named none.
const err = (value: { message: string } | null | undefined): { message: string } | null => value ?? null;

function answer(table: string, columns: string, opts: FakeOptions): { data: unknown; error: { message: string } | null } {
  switch (table) {
    case "cloud_workers": {
      // The list your workers comes from; the reported folders read asks for id and folders.
      // `null` is passed through as it is, so the source's own fallback is what's exercised.
      if (columns.includes("folders")) return rows(opts.folderRows === undefined ? [] : opts.folderRows);
      return rows(or(opts.workers, []), err(opts.workersError));
    }
    case "cloud_cards": {
      // The command target read asks for owner_user; the board's card list doesn't.
      if (columns.includes("owner_user")) return rows(opts.cardRow ?? null);
      return rows(or(opts.cards, []), err(opts.cardsError));
    }
    case "cloud_thread_items":
      if (columns === "seq") return rows(or(opts.head, []), err(opts.headError));
      return rows(or(opts.items, []), err(opts.itemsError));
    case "cloud_tool_outputs":
      return rows(opts.toolOutput ?? null, err(opts.toolError));
    case "cloud_commands":
      return rows(null, err(opts.insertError));
    default:
      return rows(null);
  }
}

// A Supabase client fake that answers the tables the worker board reads. The query chain is recorded so a
// test can see what was asked for.
export function fakeClient(opts: FakeOptions = {}) {
  const calls: { op: string; args: unknown[] }[] = [];
  let inserted: unknown = null;
  const uploads: { path: string; type?: string }[] = [];

  const builder = (table: string) => {
    // The columns of the select being built.
    let columns = "";
    const query = {
      select: (...args: unknown[]) => (calls.push({ op: "select", args: [table, ...args] }), (columns = typeof args[0] === "string" ? args[0] : ""), query),
      eq: (...args: unknown[]) => (calls.push({ op: "eq", args }), query),
      neq: (...args: unknown[]) => (calls.push({ op: "neq", args }), query),
      in: (...args: unknown[]) => (calls.push({ op: "in", args }), query),
      gt: (...args: unknown[]) => (calls.push({ op: "gt", args }), query),
      lt: (...args: unknown[]) => (calls.push({ op: "lt", args }), query),
      order: (...args: unknown[]) => (calls.push({ op: "order", args }), query),
      limit: (...args: unknown[]) => (calls.push({ op: "limit", args }), query),
      insert: (row: unknown) => {
        calls.push({ op: "insert", args: [row] });
        inserted = row;
        return query;
      },
      maybeSingle: () => {
        if (table === "cloud_cards") return Promise.resolve({ data: opts.cardRow ?? null, error: null });
        if (table === "cloud_tool_outputs") return Promise.resolve({ data: opts.toolOutput ?? null, error: opts.toolError ?? null });
        if (table === "cloud_workers" && opts.publicKey !== undefined) return Promise.resolve({ data: { public_key: opts.publicKey }, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      single: () => Promise.resolve({ data: opts.insertError ? null : { id: opts.insertId ?? "cmd-1" }, error: opts.insertError ?? null }),
      then: (resolve: (v: { data: unknown; error: { message: string } | null }) => unknown) => {
        const { data, error } = answer(table, columns, opts);
        return Promise.resolve({ data, error }).then(resolve);
      },
    };
    return query;
  };

  const client = {
    auth: {
      getSession: () => Promise.resolve({ data: { session: opts.user === null ? null : { user: { id: opts.user ?? "u-1" } } } }),
    },
    from: (t: string) => (calls.push({ op: "from", args: [t] }), builder(t)),
    // Only worker_presence_topics, which has nothing to say here.
    rpc: (fn: string, args: unknown) => (calls.push({ op: "rpc", args: [fn, args] }), Promise.resolve({ data: null, error: null })),
    storage: {
      from: () => ({
        upload: (objectPath: string, _body: unknown, o: { contentType?: string }) => (uploads.push({ path: objectPath, type: o.contentType }), Promise.resolve({ error: opts.uploadError ?? null })),
      }),
    },
  } as unknown as SupabaseClient;

  return { client, calls, uploads, inserted: () => inserted };
}

// A worker row as cloud_workers holds it.
export const workerRow = (over: Record<string, unknown> = {}) => ({
  id: "w1",
  name: "m1mini",
  status: "online",
  last_seen_at: null,
  owner_user: "u-1",
  org_id: "org-1",
  kind: "headless",
  created_at: "2026-10-01T00:00:00.000Z",
  ...over,
}) as unknown as Parameters<typeof boardFrom>[0][number];

// A card row as cloud_cards holds it.
export const cardRow = (over: Record<string, unknown> = {}) => ({
  card_id: "c1",
  owner_device: "dev-1",
  owner_worker: "w1",
  folder: "ling",
  card: { id: "c1", title: "Fix it", prompt: "fix it", cwd: "/old/path", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0 },
  ...over,
}) as unknown as Parameters<typeof boardFrom>[2][number];
