// What the desktop board reads from a worker beyond its cards (lib/worker-board-reads.ts): a project's snapshot with
// its worker's name and status, and a host verb's value, inline or from the blob store.
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./account", () => ({ accountClient: () => ({}) }));
const requireSession = vi.hoisted(() => vi.fn(() => Promise.resolve({ uid: "u-1", org: "org-1" })));
vi.mock("./worker-board", () => ({ requireSession }));
const readBlob = vi.hoisted(() => vi.fn());
vi.mock("./blob-read", () => ({ readBlob }));
const watchWorkerProjects = vi.hoisted(() => vi.fn());
vi.mock("./worker-project-live", () => ({ watchWorkerProjects }));

const { workerProjectSnapshot, workerResultBlob } = await import("./worker-board-reads");

type Answer = { data: unknown; error: { message: string } | null };
const NOW = Date.parse("2026-11-02T12:00:00.000Z");

// A client whose maybeSingle answers per table; the filters asked for are kept.
function client(answers: Record<string, Answer>) {
  const filters: unknown[][] = [];
  const from = (table: string) => {
    const q = {
      select: () => q,
      eq: (...args: unknown[]) => (filters.push([table, ...args]), q),
      maybeSingle: () => Promise.resolve(answers[table] ?? { data: null, error: null }),
    };
    return q;
  };
  return { client: { from } as unknown as SupabaseClient, filters };
}

const worker = { data: { id: "w1", name: "m1mini", status: "online", last_seen_at: new Date(NOW - 30_000).toISOString() }, error: null };
const snapshot = { at: 1, quality: null, scout: null, pile: { root: "/w/ling", files: 1, added: 2, removed: 0, cards: 0 }, backlog: null };

beforeEach(() => vi.clearAllMocks());

describe("workerProjectSnapshot", () => {
  it("reads the project's row with the worker's name and status", async () => {
    const c = client({ cloud_workers: worker, cloud_worker_projects: { data: { snapshot, updated_at: "2026-11-02T11:50:00.000Z" }, error: null } });
    await expect(workerProjectSnapshot("worker://w1/ling", c.client, NOW)).resolves.toEqual({ snapshot, updatedAt: "2026-11-02T11:50:00.000Z", worker: "m1mini", status: "online" });
    expect(c.filters).toContainEqual(["cloud_worker_projects", "folder", "ling"]);
    expect(c.filters).toContainEqual(["cloud_worker_projects", "org_id", "org-1"]);
    // From the first read on, the workspace's new snapshots are heard live.
    expect(watchWorkerProjects).toHaveBeenCalledWith(c.client, "org-1");
  });

  it("still reads when the client can't hold a live subscription", async () => {
    watchWorkerProjects.mockImplementationOnce(() => {
      throw new Error("no realtime");
    });
    const c = client({ cloud_workers: worker });
    await expect(workerProjectSnapshot("worker://w1/ling", c.client, NOW)).resolves.toMatchObject({ worker: "m1mini" });
  });

  it("has no snapshot before the worker wrote one, or before the table exists, and says when it's offline", async () => {
    const stale = { ...worker, data: { ...worker.data, last_seen_at: "2026-11-01T00:00:00.000Z" } };
    const none = client({ cloud_workers: stale });
    await expect(workerProjectSnapshot("worker://w1/ling", none.client, NOW)).resolves.toEqual({ snapshot: null, updatedAt: null, worker: "m1mini", status: "offline" });
    const missing = client({ cloud_workers: worker, cloud_worker_projects: { data: null, error: { message: "relation does not exist" } } });
    await expect(workerProjectSnapshot("worker://w1/ling", missing.client, NOW)).resolves.toMatchObject({ snapshot: null });
  });

  it("refuses a path that isn't a worker's, and a worker outside the workspace", async () => {
    await expect(workerProjectSnapshot("/Users/me/ling", client({}).client)).rejects.toThrow("isn't a worker project");
    await expect(workerProjectSnapshot("worker://w9/ling", client({}).client)).rejects.toThrow("isn't in your workspace");
  });
});

describe("workerResultBlob", () => {
  const SHA = "ef".repeat(32);

  it("reads a result's JSON from the blob store with the account's session", async () => {
    readBlob.mockResolvedValueOnce({ bytes: new TextEncoder().encode('{"file":{"text":"x"}}').buffer, type: "application/json" });
    const c = client({});
    await expect(workerResultBlob(SHA, c.client)).resolves.toEqual({ value: { file: { text: "x" } } });
    expect(readBlob).toHaveBeenCalledWith(c.client, "org-1", `results/${SHA}`, { r2: null });
  });

  it("says when it isn't there, or isn't a sha", async () => {
    readBlob.mockResolvedValueOnce(null);
    await expect(workerResultBlob(SHA, client({}).client)).rejects.toThrow("isn't in the blob store");
    await expect(workerResultBlob("../x", client({}).client)).rejects.toThrow("isn't a result");
    expect(readBlob).toHaveBeenCalledTimes(1);
  });
});
