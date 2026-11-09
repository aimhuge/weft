// Fakes for lib/share-access.ts's tests (lib/share-access.test.ts, lib/share-access-grant.test.ts): a share gate kit,
// share and card rows, a per-table query builder and a service client whose share_grant_admits RPC answers from `grants`.
import { vi } from "vitest";

export const fakeGate = {
  cookieName: (id: string) => `weft_share_${id.slice(0, 4)}`,
  sign: (id: string) => `signed:${id}`,
  verify: (id: string, v?: string) => Boolean(v) && v === `signed:${id}`,
  cookieOptions: () => ({ httpOnly: true, secure: false, sameSite: "lax" as const, path: "/", maxAge: 60 }),
  ttlMs: 60_000,
};


export function shareRow(over: Partial<{ id: string; org_id: string; card_id: string; mode: string; password_hash: string | null }> = {}) {
  return {
    id: "sh1",
    org_id: "org-1",
    card_id: "c1",
    mode: "public",
    password_hash: null,
    created_by: "u1",
    created_at: "2026-10-17T00:00:00.000Z",
    updated_at: "2026-10-17T00:00:00.000Z",
    ...over,
  };
}

export function cardRow(over: Partial<{ card_id: string; card: unknown; deleted: boolean; updated_at: string }> = {}) {
  return { card_id: "c1", card: { id: "c1", title: "T" }, deleted: false, updated_at: "2026-10-17T00:00:00.000Z", ...over };
}

// A query builder bound to a single table; chains like `.select().eq().maybeSingle()` resolve to
// whatever the test set on `from` for that table. Each call to `builder()` returns a fresh chain.
export function fromTable(table: string, rows: { share?: unknown; card?: unknown; membership?: unknown; profile?: unknown; slugShare?: unknown }, errors: Record<string, { message: string }> = {}) {
  const make = (): Record<string, unknown> => {
    const builder: Record<string, unknown> = {};
    const chainMethods = ["select", "eq", "order", "limit", "lt", "gt"];
    for (const m of chainMethods) builder[m] = vi.fn(() => make());
    builder.maybeSingle = vi.fn(() => {
      if (table === "cloud_shares") return Promise.resolve({ data: rows.share ?? rows.slugShare ?? null, error: errors.cloud_shares ?? null });
      if (table === "cloud_cards") return Promise.resolve({ data: rows.card ?? null, error: errors.cloud_cards ?? null });
      if (table === "org_memberships") return Promise.resolve({ data: rows.membership ?? null, error: errors.org_memberships ?? null });
      if (table === "profiles") return Promise.resolve({ data: rows.profile ?? null, error: errors.profiles ?? null });
      return Promise.resolve({ data: null, error: null });
    });
    builder.insert = vi.fn(() => Promise.resolve(({ error: null })));
    return builder;
  };
  return make();
}

// Whether share_grant_admits lets the visitor in (lib/share-grant-gate.ts), and what it was asked.
export const grants = { admit: false as boolean, calls: [] as unknown[] };

// A service-client stub: one .from() per table, each returning its own chainable, and the grant RPC.
export function serviceWith(tables: Record<string, ReturnType<typeof fromTable>>) {
  return {
    from: (table: string) => tables[table] ?? fromTable(table, {}),
    rpc: (name: string, args: unknown) => {
      grants.calls.push({ name, args });
      return Promise.resolve({ data: grants.admit, error: null });
    },
  };
}
