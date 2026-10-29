import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { R2Config } from "./r2";
import { mirrorOne, mirrorPending, mirrorShas, type PendingBlob } from "./r2-mirror";

const ORG = "11111111-2222-3333-4444-555555555555";
const R2: R2Config = { accountId: "0123456789abcdef0123456789abcdef", accessKeyId: "k", secretAccessKey: "s", bucket: "weft-blobs" };
const sha = (c: string) => c.repeat(64);

// A service client over an in-memory bucket and blob_mirror: blob_mirror_pending answers the bucket's objects
// with no mirror row, like the SQL function does.
function fakeService(objects: PendingBlob[], opts: { missing?: string[]; insertError?: boolean; rpcError?: boolean } = {}) {
  const mirrored = new Set<string>();
  const service = {
    rpc: vi.fn((_name: string, args: { max_rows: number }) => {
      if (opts.rpcError) return Promise.resolve({ data: null, error: { message: "permission denied" } });
      return Promise.resolve({ data: objects.filter((o) => !mirrored.has(o.sha)).slice(0, args.max_rows), error: null });
    }),
    storage: {
      from: () => ({
        download: (path: string) =>
          Promise.resolve(opts.missing?.some((m) => path.endsWith(m)) ? { data: null, error: { message: "Object not found" } } : { data: new Blob(["bytes!"], { type: "image/png" }), error: null }),
      }),
    },
    from: () => ({
      upsert: (row: { sha: string }) => {
        if (opts.insertError) return Promise.resolve({ error: { message: "denied" } });
        mirrored.add(row.sha);
        return Promise.resolve({ error: null });
      },
    }),
  };
  return { service: service as unknown as SupabaseClient, mirrored, rpc: service.rpc };
}

const ok = () => vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
const blob = (c: string): PendingBlob => ({ org_id: ORG, sha: sha(c), bytes: 6, content_type: "image/png" });

describe("mirrorOne", () => {
  it("downloads, PUTs to R2 and records the copy", async () => {
    const { service, mirrored } = fakeService([]);
    const fetchImpl = ok();
    expect(await mirrorOne(service, R2, blob("a"), fetchImpl)).toBe(6);
    const [url, init] = fetchImpl.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toContain(`/weft-blobs/${ORG}/${sha("a")}`);
    expect(init.headers["content-type"]).toBe("image/png");
    expect(mirrored.has(sha("a"))).toBe(true);
  });

  it("takes the type from the download when the row has none", async () => {
    const { service } = fakeService([]);
    const fetchImpl = ok();
    await mirrorOne(service, R2, { org_id: ORG, sha: sha("a") }, fetchImpl);
    expect((fetchImpl.mock.calls[0] as [string, { headers: Record<string, string> }])[1].headers["content-type"]).toBe("image/png");
  });

  it("throws on a missing object or a failed record, and records nothing R2 refused", async () => {
    await expect(mirrorOne(fakeService([], { missing: [sha("a")] }).service, R2, blob("a"), ok())).rejects.toThrow("Object not found");
    await expect(mirrorOne(fakeService([], { insertError: true }).service, R2, blob("a"), ok())).rejects.toThrow("record");
    const refused = fakeService([]);
    await expect(mirrorOne(refused.service, R2, blob("a"), vi.fn().mockResolvedValue(new Response(null, { status: 403 })))).rejects.toThrow("403");
    expect(refused.mirrored.size).toBe(0);
  });
});

describe("mirrorPending", () => {
  it("drains every pending object in batches", async () => {
    const objects = ["a", "b", "c", "d", "e"].map(blob);
    const { service, mirrored } = fakeService(objects);
    const result = await mirrorPending(service, R2, { batch: 2, fetchImpl: ok() });
    expect(result).toEqual({ copied: 5, bytes: 30, failed: [], more: false });
    expect(mirrored.size).toBe(5);
  });

  it("steps past objects that keep failing instead of looping on them", async () => {
    const { service, mirrored } = fakeService(["a", "b", "c"].map(blob), { missing: [sha("a")] });
    const result = await mirrorPending(service, R2, { batch: 1, fetchImpl: ok() });
    expect(result.copied).toBe(2);
    expect(result.failed).toHaveLength(1);
    expect(result.more).toBe(false);
    expect(mirrored.has(sha("a"))).toBe(false);
  });

  it("stops after three batches in a row copy nothing, and says there's more", async () => {
    const { service } = fakeService(["a", "b", "c", "d", "e"].map(blob));
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    const result = await mirrorPending(service, R2, { batch: 1, fetchImpl });
    expect(result.copied).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.more).toBe(true);
  });

  it("says there's more when the time budget runs out", async () => {
    const { service } = fakeService(["a", "b", "c"].map(blob));
    let t = 0;
    const result = await mirrorPending(service, R2, { batch: 1, budgetMs: 2, now: () => t++, fetchImpl: ok() });
    expect(result.copied).toBe(1);
    expect(result.more).toBe(true);
  });

  it("throws when the pending list can't be read", async () => {
    await expect(mirrorPending(fakeService([], { rpcError: true }).service, R2)).rejects.toThrow("permission denied");
  });
});

describe("mirrorShas", () => {
  it("copies each sha once and swallows failures", async () => {
    const { service, mirrored } = fakeService([], { missing: [sha("b")] });
    const fetchImpl = ok();
    await mirrorShas(service, R2, ORG, [sha("a"), sha("a"), sha("b")], fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect([...mirrored]).toEqual([sha("a")]);
  });
});
