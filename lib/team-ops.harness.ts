// Shared fixtures and the chainable from() builder the team-ops tests
// (lib/team-ops.test.ts) use to fake a Supabase service client. Each test
// file holds its own vi.hoisted mocks and vi.mock calls — module state is
// per-test file — so what's shared is the static fixtures, the role-rank
// map (actorAtLeast), and the helper that wires the chainable query.
//
// lib/team-actions.harness.ts is the same idea for the server actions; the
// two share USER/ORG/actorAtLeast/makeService/formData by convention. If
// you change one, change the other.
import { vi } from "vitest";

export const USER = { id: "u1", email: "jane@example.com", name: "Jane", avatar: null };
export const ORG = { id: "o1", slug: "acme", name: "Acme" };

// roleAtLeast's two-argument shape: rank("owner") > rank("admin") > rank("member"). The
// implementation is a Record lookup; a missing rank is undefined, and `undefined >= undefined`
// is false, so any unknown role is treated as "not at least" — the same verdict the old inline
// `({...})[actor] >= ({...})[target]` returned.
const ROLE_LEVELS: Record<string, number> = { owner: 3, admin: 2, member: 1 };
export function actorAtLeast(actor: string, target: string): boolean {
  const a = ROLE_LEVELS[actor];
  const t = ROLE_LEVELS[target];
  return a !== undefined && t !== undefined && a >= t;
}

// The chainable from() builder: the test pins rows for each (table, operation) pair and a per-call
// insert/update/delete return so an error path can be exercised. Supabase's API is thenable AND
// chainable, so the same chain is awaited at the end of a query.
export function makeService(
  rowsByTable: Record<string, unknown[]> = {},
  errorsByTable: Record<string, { message: string }> = {},
  writesByTable: Record<string, { error: { message: string } | null }> = {},
): { client: { from: (table: string) => Record<string, unknown> } } {
  const from = vi.fn((table: string): Record<string, unknown> => {
    const rows = rowsByTable[table] ?? [];
    const err = errorsByTable[table] ?? null;
    const write = writesByTable[table] ?? { error: null };
    const chain: Record<string, unknown> = {};
    const then = (resolve: (v: unknown) => void) => {
      const isWrite = chain.__write === true;
      return Promise.resolve(
        isWrite
          ? { data: null, error: write.error, count: 0 }
          : { data: rows[0] ?? null, error: err, count: rows.length },
      ).then(resolve);
    };
    for (const m of ["select", "eq", "in", "is", "maybeSingle", "single", "order", "limit"]) {
      chain[m] = vi.fn(() => chain);
    }
    for (const m of ["insert", "update", "delete", "upsert"]) {
      chain[m] = vi.fn(() => {
        chain.__write = true;
        return chain;
      });
    }
    Object.defineProperty(chain, "then", { value: then, configurable: true });
    return chain;
  });
  return { client: { from } };
}
