// The in-memory Supabase stand-in lib/team-vault-rotate.test.ts runs the writer against.
//
// The queries the writer makes are read-then-write chains, and the writes have to be *observable* —
// which rows went in, in what order — because the order is the security property. The grants go in
// before the version bump, the revocation comes after the re-encrypted rows, and the removed device
// never gets a grant.
//
// This lives beside the test rather than in it: the fake is bigger than the test that uses it, and
// the repo's convention (lib/team-ops.harness.ts, electron/vault-sync.harness.ts) is a harness file
// next to the tests.
import { vi } from "vitest";
import type { RotatePlan } from "./team-vault-rotate";

export type Row = Record<string, unknown>;

export type Fake = {
  client: { from: (table: string) => unknown };
  // Every write the fake saw, in order: { table, op }.
  calls: { table: string; op: string }[];
  // The rows that were written, by table.
  writes: Record<string, Row[]>;
  // Make one (table, op) fail, the way a database error would.
  failOn: (table: string, op: string, message: string) => void;
};

// The query state of one chain: what it does, what it filters on, what it carries.
type Query = {
  op: "select" | "upsert" | "update" | "insert" | "delete";
  filters: { column: string; value: unknown }[];
  lists: { column: string; values: unknown[] }[];
  payload: Row | Row[] | null;
  single: boolean;
};

export function makeFake(seed: Record<string, Row[]> = {}): Fake {
  const calls: { table: string; op: string }[] = [];
  const rows: Record<string, Row[]> = {};
  const writes: Record<string, Row[]> = {};
  const failures: { table: string; op: string; message: string }[] = [];

  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const query: Query = { op: "select", filters: [], lists: [], payload: null, single: false };
      const matches = (row: Row) =>
        query.filters.every((f) => row[f.column] === f.value) && query.lists.every((l) => l.values.includes(row[l.column]));

      // The answer the chain gives when it's awaited.
      const settle = (resolve: (v: unknown) => void) => {
        const failure = failures.find((f) => f.table === table && f.op === query.op);
        if (failure) {
          void Promise.resolve({ data: null, error: { message: failure.message }, count: 0 }).then(resolve);
          return;
        }
        if (query.op === "select") {
          const found = (rows[table] ?? []).filter(matches);
          void Promise.resolve({ data: query.single ? (found[0] ?? null) : found, error: null, count: found.length }).then(resolve);
          return;
        }
        if (query.op === "update") {
          // Supabase's update touches the matched rows and returns them; the fake writes the payload
          // merged onto each matched row, so the test can see what the row became.
          const updated = (rows[table] ?? []).filter(matches).map((row) => ({ ...row, ...(query.payload as Row) }));
          writes[table] = [...(writes[table] ?? []), ...updated];
          void Promise.resolve({ data: updated, error: null, count: updated.length }).then(resolve);
          return;
        }
        if (query.op === "upsert" || query.op === "insert") {
          const incoming = Array.isArray(query.payload) ? query.payload : [query.payload as Row];
          writes[table] = [...(writes[table] ?? []), ...incoming];
          void Promise.resolve({ data: null, error: null, count: incoming.length }).then(resolve);
          return;
        }
        void Promise.resolve({ data: null, error: null, count: 0 }).then(resolve);
      };

      chain.select = vi.fn(() => {
        query.op = "select";
        return chain;
      });
      chain.eq = vi.fn((column: string, value: unknown) => {
        query.filters.push({ column, value });
        return chain;
      });
      chain.in = vi.fn((column: string, values: unknown[]) => {
        query.lists.push({ column, values });
        return chain;
      });
      chain.maybeSingle = vi.fn(() => {
        query.single = true;
        return chain;
      });
      chain.single = vi.fn(() => {
        query.single = true;
        return chain;
      });
      chain.upsert = vi.fn((payload: Row | Row[]) => {
        query.op = "upsert";
        query.payload = payload;
        calls.push({ table, op: "upsert" });
        return chain;
      });
      chain.update = vi.fn((payload: Row) => {
        query.op = "update";
        query.payload = payload;
        calls.push({ table, op: "update" });
        return chain;
      });
      chain.insert = vi.fn((payload: Row) => {
        query.op = "insert";
        query.payload = payload;
        calls.push({ table, op: "insert" });
        return chain;
      });
      chain.delete = vi.fn(() => {
        query.op = "delete";
        calls.push({ table, op: "delete" });
        return chain;
      });
      Object.defineProperty(chain, "then", { value: settle, configurable: true });
      return chain;
    },
  };

  for (const [table, list] of Object.entries(seed)) rows[table] = list.map((r) => ({ ...r }));

  return {
    client,
    calls,
    writes,
    failOn: (table, op, message) => failures.push({ table, op, message }),
  };
}

// ─── fixtures ─────────────────────────────────────────────────────────────

export const ORG_ID = "org-1";
export const VAULT_ID = "vault-1";

// The plan Electron main made: one sealed copy for each device that stays, one re-encrypted value,
// and the name to change at its provider.
export function plan(over: Partial<RotatePlan> = {}): RotatePlan {
  return {
    vaultId: VAULT_ID,
    keyVersion: 2,
    previousKeyVersion: 1,
    revokedDeviceId: "device-gone",
    grants: [
      { deviceId: "device-admin", wrappedKey: "sealed-admin" },
      { deviceId: "device-mate", wrappedKey: "sealed-mate" },
    ],
    secrets: [{ name: "API_KEY", environment: "development", ciphertext: "ct-new", nonce: "n-new", rowVersion: 4 }],
    namesToRotate: ["API_KEY"],
    ...over,
  };
}

// Who did it: the admin whose session the route read.
export const ACTOR = { userId: "u1", email: "jane@example.com" };

// A vault on key version 1, with the row the re-encryption updates and the device the revocation
// touches. The seed every applyRotate test starts from.
export function vaultSeed(over: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    vaults: [{ id: VAULT_ID, current_key_version: 1, org_id: ORG_ID }],
    vault_secrets: [{ id: "s1", vault_id: VAULT_ID, name: "API_KEY", environment: "development", row_version: 4 }],
    devices: [{ id: "device-gone" }, { id: "device-admin" }],
    ...over,
  };
}
