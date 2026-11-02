// A supabase-js stand-in for lib/connector-db.test.ts and lib/connector-db-trust.test.ts: every builder records itself
// and returns the chain; awaiting it (or maybeSingle/single) answers the next queued response; rpc and
// auth.admin.getUserById answer from the same queue.
import type { SupabaseClient } from "@supabase/supabase-js";

export type R = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };
export const ok = (data: unknown, count?: number | null): R => ({ data, error: null, count });
export const fail = (message: string, code?: string): R => ({ data: null, error: { message, code } });

const BUILDERS = ["select", "insert", "update", "upsert", "delete", "eq", "gte", "lt", "not", "in", "or", "limit"];

export function fakeSupabase(...responses: R[]) {
  const calls: { table: string; ops: unknown[][] }[] = [];
  const next = () => Promise.resolve(responses.shift() ?? ok(null));
  const from = (table: string) => {
    const rec = { table, ops: [] as unknown[][] };
    calls.push(rec);
    const q: Record<string, unknown> = {};
    for (const name of BUILDERS) {
      q[name] = (...args: unknown[]) => {
        rec.ops.push([name, ...args]);
        return q;
      };
    }
    q.maybeSingle = () => (rec.ops.push(["maybeSingle"]), next());
    q.single = () => (rec.ops.push(["single"]), next());
    q.then = (res: (r: R) => unknown, rej: (e: unknown) => unknown) => next().then(res, rej);
    return q;
  };
  const rpc = (fn: string, args: unknown) => (calls.push({ table: `rpc:${fn}`, ops: [[args]] }), next());
  const auth = { admin: { getUserById: (id: string) => (calls.push({ table: "auth", ops: [[id]] }), next()) } };
  return { client: { from, rpc, auth } as unknown as SupabaseClient, calls };
}
