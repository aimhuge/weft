import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// How Settings → Sync → Workers says a worker is up (lib/workers-account.ts statusOf): a headless worker from presence,
// then its row against the slow beat (lib/worker-presence.ts); a desktop from its row alone.
vi.mock("./account", () => ({ accountClient: () => { throw new Error("no default client in tests"); } }));
vi.mock("./cloud-sync", () => ({ syncOrgId: () => Promise.resolve("org-1") }));
vi.mock("./device-id", () => ({ deviceId: () => "dev-here" }));

const { listWorkers, OFFLINE_AFTER_MS } = await import("./workers-account");
const { ABSENT_OFFLINE_AFTER_MS, SLOW_OFFLINE_AFTER_MS } = await import("./worker-presence");

function fakeClient(rows: unknown[]) {
  const calls: unknown[][] = [];
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    limit: () => query,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  const client = {
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: "u-1" } } } }) },
    from: () => query,
    rpc: (fn: string, args: unknown) => (calls.push([fn, args]), Promise.resolve({ data: null, error: null })),
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("listWorkers' status", () => {
  it("reads your headless workers from presence, then the rows against the slow beat", async () => {
    const now = Date.parse("2026-10-29T10:00:00.000Z");
    const ago = (ms: number) => new Date(now - ms).toISOString();
    const base = { platform: "linux", arch: "x64", status: "online" as const };
    const { client, calls } = fakeClient([
      { ...base, id: "w-1", owner_user: "u-1", name: "up", last_seen_at: ago(OFFLINE_AFTER_MS + 1) },
      { ...base, id: "w-2", owner_user: "u-1", name: "gone", last_seen_at: ago(ABSENT_OFFLINE_AFTER_MS + 1) },
      { ...base, id: "w-3", owner_user: "u-2", name: "teammate's", last_seen_at: ago(OFFLINE_AFTER_MS + 1) },
      { ...base, id: "w-4", owner_user: "u-2", name: "teammate's, quiet", last_seen_at: ago(SLOW_OFFLINE_AFTER_MS + 1) },
      { ...base, id: "w-5", owner_user: "u-1", name: "a Mac", last_seen_at: ago(OFFLINE_AFTER_MS + 1), kind: "desktop", device: "dev-1" },
    ]);
    const read = vi.fn(async (rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<unknown>) => {
      await rpc("worker_presence_topics", {});
      return { known: new Set(["w-1", "w-2"]), present: new Map([["w-1", "busy" as const]]) };
    });
    const view = await listWorkers(client, now, { read });
    expect(read).toHaveBeenCalledWith(expect.any(Function), ["w-1", "w-2"], { owner: "u-1", all: true });
    expect(calls).toContainEqual(["worker_presence_topics", {}]);
    expect(view.workers.map((w) => w.status)).toEqual(["busy", "offline", "online", "offline", "offline"]);
  });
});
