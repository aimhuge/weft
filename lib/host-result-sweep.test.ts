// Host results' blobs expire after a day (lib/host-result-sweep.ts): one workspace's sweep, and every workspace's.
import { describe, expect, it, vi } from "vitest";
import { RESULT_TTL_MS, sweepAllResults, sweepResults } from "./host-result-sweep";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const old = new Date(NOW - RESULT_TTL_MS - 1).toISOString();
const fresh = new Date(NOW - 1_000).toISOString();

type Listed = { data: unknown; error: { message: string } | null };

function storage(listed: (folder: string) => Listed, removed: { error: { message: string } | null } = { error: null }) {
  const list = vi.fn((folder: string) => Promise.resolve(listed(folder)));
  const remove = vi.fn(() => Promise.resolve(removed));
  const from = vi.fn(() => ({ list, remove }));
  return { list, remove, from, storage: { from } };
}

describe("sweepResults", () => {
  it("removes the workspace's results over a day old, oldest first, and only those", async () => {
    const s = storage(() => ({ data: [{ name: "a", created_at: old }, { name: "b", created_at: fresh }, { name: "c" }], error: null }));
    expect(await sweepResults(s as never, "org-1", NOW)).toBe(1);
    expect(s.from).toHaveBeenCalledWith("weft-blobs");
    expect(s.list).toHaveBeenCalledWith("org-1/results", { limit: 1000, sortBy: { column: "created_at", order: "asc" } });
    expect(s.remove).toHaveBeenCalledWith(["org-1/results/a"]);
  });

  it("removes nothing when nothing is old, and throws when the bucket fails", async () => {
    const none = storage(() => ({ data: [{ name: "b", created_at: fresh }], error: null }));
    expect(await sweepResults(none as never, "org-1")).toBe(0);
    expect(none.remove).not.toHaveBeenCalled();
    await expect(sweepResults(storage(() => ({ data: null, error: { message: "list failed" } })) as never, "org-1", NOW)).rejects.toThrow("list failed");
    const broken = storage(() => ({ data: [{ name: "a", created_at: old }], error: null }), { error: { message: "remove failed" } });
    await expect(sweepResults(broken as never, "org-1", NOW)).rejects.toThrow("remove failed");
  });
});

describe("sweepAllResults", () => {
  function service(rows: { data: unknown; error: { message: string } | null }, listed: (folder: string) => Listed) {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), overrideTypes: vi.fn(() => Promise.resolve(rows)) };
    const s = storage(listed);
    return { query, s, client: { from: vi.fn(() => query), storage: s.storage } };
  }

  it("sweeps each workspace with a headless worker once, naming one that fails and carrying on", async () => {
    const { query, client } = service({ data: [{ org_id: "o1" }, { org_id: "o2" }, { org_id: "o1" }, { org_id: "o3" }], error: null }, (folder) =>
      folder.startsWith("o2") ? { data: null, error: { message: "list failed" } } : { data: [{ name: "x", created_at: old }], error: null },
    );
    expect(await sweepAllResults(client as never, NOW)).toEqual({ orgs: 3, removed: 2, failed: ["o2: list failed"] });
    expect(client.from).toHaveBeenCalledWith("cloud_workers");
    expect(query.eq).toHaveBeenCalledWith("kind", "headless");
  });

  it("throws when the workers can't be read", async () => {
    const { client } = service({ data: null, error: { message: "denied" } }, () => ({ data: [], error: null }));
    await expect(sweepAllResults(client as never)).rejects.toThrow("denied");
  });
});
