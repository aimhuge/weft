// The fake Supabase client lib/device-calls.test.ts drains against.
import { vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeviceCallRow } from "./device-calls";
// A Supabase client with the chained methods this module uses, and the calls it makes recorded.
export interface FakeCalls {
  updates: Array<{ patch: Record<string, unknown>; eqs: string[] }>;
  selects: string[];
}

export function fakeClient({ session = "token-1", pending = [] as DeviceCallRow[], claimable = true, selectError = null as { message: string } | null, answerError = null as { message: string } | null }: { session?: string | null; pending?: DeviceCallRow[]; claimable?: boolean; selectError?: { message: string } | null; answerError?: { message: string } | null } = {}) {
  const calls: FakeCalls = { updates: [], selects: [] };
  const table = () => {
    // The chain: update().eq().eq().select() for a claim, update().eq() for an answer,
    // select().eq().eq().eq().order().limit().overrideTypes() for the pending rows.
    const chain: Record<string, unknown> = {};
    // The answer's chain ends at the first eq(), and the claim's at the second.
    const first = {
      then: (resolve: (v: unknown) => unknown) => resolve({ error: answerError }),
    } as Record<string, unknown>;
    chain.eq = vi.fn(() => ({
      ...first,
      eq: vi.fn((column: string) => {
        calls.updates.at(-1)?.eqs.push(column);
        return { select: vi.fn(() => Promise.resolve({ data: claimable ? [{ id: "call-1" }] : [], error: null })) };
      }),
    }));
    chain.update = vi.fn((patch: Record<string, unknown>) => {
      calls.updates.push({ patch, eqs: [] });
      return chain;
    });
    chain.select = vi.fn((columns: string) => {
      calls.selects.push(columns);
      const q = {
        eq: vi.fn(() => q),
        order: vi.fn(() => q),
        limit: vi.fn(() => q),
        overrideTypes: vi.fn(() => Promise.resolve(selectError ? { data: null, error: selectError } : { data: pending, error: null })),
      };
      return q;
    });
    return chain;
  };
  const client = {
    auth: { getSession: vi.fn(() => Promise.resolve({ data: { session: session === null ? null : { access_token: session } } })) },
    from: vi.fn(() => table()),
  } as unknown as SupabaseClient;
  return { client, calls };
}
