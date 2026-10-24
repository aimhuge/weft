// The fake account client lib/app-share.test.ts runs against: a query builder that answers from a
// plain object, a write log, and the row a write leaves behind. Extracted from the test file so the
// test file holds the behaviour and this holds the scaffolding (same split as
// lib/app-share-access.test-helpers.ts).
import { vi } from "vitest";

export interface Db {
  user: string | null;
  org: string | null;
  configured: boolean;
  apps: { id: string; name: string; url: string }[];
  share: { id: string; mode: string; has_password: boolean; name: string; kind: string; page: string; owner: "user" | "org"; slug: string | null; files: Record<string, string> | null; manifest: unknown; org_id: string } | null;
  error: { message: string } | null;
  queries: { table: string; filters: Record<string, unknown> }[];
  // The column list each select() asked for, so a test can pin what the row read selects.
  selects: string[];
  writes: { op: "insert" | "update" | "delete"; row: Record<string, unknown>; filters: Record<string, unknown> }[];
  profile: { username: string } | null;
  orgs: { id: string; slug: string; name: string }[];
}

export type Uploaded = { paths: string[] };

// The row from a write: the columns from the write, the rest from the previous row. New columns (owner,
// slug, files, manifest, org_id) only get written when present so a row that doesn't touch them keeps them.
export function applyRow(db: Db, row: Record<string, unknown>): NonNullable<Db["share"]> {
  const prior = db.share;
  const fallback: NonNullable<Db["share"]> = { id: "id", mode: "private", has_password: false, name: "", kind: "site", page: "", owner: "user", slug: null, files: null, manifest: null, org_id: "o1" };
  const base = prior ?? fallback;
  return {
    id: (row.id as string | undefined) ?? base.id,
    mode: (row.mode as string | undefined) ?? base.mode,
    has_password: "password_hash" in row ? row.password_hash !== null : base.has_password,
    name: (row.name as string | undefined) ?? base.name,
    kind: (row.kind as string | undefined) ?? base.kind,
    page: (row.page as string | undefined) ?? base.page,
    owner: ((row.owner as string | undefined) ?? base.owner) as "user" | "org",
    slug: (row.slug === undefined ? base.slug : row.slug) as string | null,
    files: (row.files === undefined ? base.files : row.files) as Record<string, string> | null,
    manifest: row.manifest === undefined ? base.manifest : row.manifest,
    org_id: (row.org_id as string | undefined) ?? base.org_id,
  };
}

export function makeQuery(db: Db) {
  function write(op: "insert" | "update" | "delete", row: Record<string, unknown>, filters: Record<string, unknown>) {
    db.writes.push({ op, row, filters });
    if (db.error) return Promise.resolve({ error: db.error });
    if (op === "delete") { db.share = null; return Promise.resolve({ error: null }); }
    db.share = applyRow(db, row);
    return Promise.resolve({ error: null });
  }
  // The route hits cloud_app_shares (read/write), profiles, and org_memberships; the latter two
  // answer from db.profile and db.orgs (mocked Promise.all in app-share-owners.ts).
  return function query(table: string) {
    const dataFor = () => {
      if (table === "cloud_app_shares") return db.share;
      if (table === "profiles") return db.profile;
      if (table === "org_memberships") return db.orgs.map((o) => ({ org_id: o.id, orgs: o }));
      return null;
    };
    const filters: Record<string, unknown> = {};
    const push = () => db.queries.push({ table, filters });
    const thenable = (done: (r: { data: unknown; error: { message: string } | null }) => unknown) =>
      Promise.resolve(db.error ? { data: null, error: db.error } : { data: dataFor(), error: null }).then(done);
    const q = {
      select: (columns?: string) => { push(); if (typeof columns === "string") db.selects.push(columns); return q; },
      eq: (col: string, value: unknown) => { filters[col] = value; return q; },
      maybeSingle: () => {
        push();
        return Promise.resolve(db.error ? { data: null, error: db.error } : { data: dataFor(), error: null });
      },
      then: thenable,
      insert: (row: Record<string, unknown>) => write("insert", row, {}),
      update: (row: Record<string, unknown>) => {
        const where: Record<string, unknown> = {};
        const chain = {
          eq: (col: string, value: unknown) => { where[col] = value; return chain; },
          then: (done: (r: { error: { message: string } | null }) => unknown) => write("update", row, where).then(done),
        };
        return chain;
      },
      delete: () => {
        const where: Record<string, unknown> = {};
        const chain = {
          eq: (col: string, value: unknown) => { where[col] = value; return chain; },
          then: (done: (r: { error: { message: string } | null }) => unknown) => write("delete", {}, where).then(done),
        };
        return chain;
      },
    };
    return q;
  };
}

export type FakeQuery = ReturnType<typeof makeQuery>;

// The fake Supabase client: the query builder above, a session, and a storage bucket that records
// every upload. Typed as the fake's own chain (not Supabase's overloaded from()) so a test can swap
// in a bespoke builder that wraps the same query and still satisfies the assignment.
export function makeClient(db: Db, uploaded: Uploaded) {
  const query = makeQuery(db);
  return {
    auth: { getSession: () => Promise.resolve({ data: { session: db.user ? { user: { id: db.user } } : null } }) },
    from: query as (table: string) => Record<string, unknown>,
    query,
    storage: { from: () => ({ upload: vi.fn((p: string) => { uploaded.paths.push(p); return Promise.resolve({ error: null }); }) }) },
  };
}
