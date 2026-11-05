// The live infrastructure route (GET /api/infra/live): the read behind the repo-analysis report's
// "Infrastructure & quotas" section.
//
// The route's promise is that a source which can't be read never fails the whole answer: the
// report shows one source's number and says the other is unread. These tests hold it to that.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InfraSnapshot } from "@/lib/infra-live";

vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

vi.mock("@/lib/supabase-project", () => ({ SUPABASE_URL: "https://abc.supabase.co" }));

vi.mock("@/lib/infra-live", async () => {
  const actual = await vi.importActual<typeof import("@/lib/infra-live")>("@/lib/infra-live");
  return {
    ...actual,
    readInfraLive: vi.fn(() => {
      if (!process.env.SUPABASE_SECRET_KEY) return Promise.reject(new Error("SUPABASE_SECRET_KEY isn't set, so the live numbers can't be read."));
      return Promise.resolve({
        database_bytes: 171 * 1024 * 1024,
        public_bytes: 100 * 1024 * 1024,
        table_count: 12,
        total_tables: 30,
        storage_bytes: 226 * 1024 * 1024,
        storage_objects: 3699,
        storage_bucket: "weft-blobs",
        storage_24h_bytes: 1024,
        storage_24h_objects: 3,
        auth_users: 5,
        auth_24h: 1,
        cloud_cards: 10,
        cloud_cards_live: 9,
        thread_items: 100,
        thread_items_24h: 4,
        share_links: 2,
        share_visits: 7,
        oldest_card: "2026-10-01T00:00:00.000Z",
      });
    }),
    readEgress: vi.fn(() => {
      if (!process.env.SUPABASE_ACCESS_TOKEN) return Promise.reject(new Error("SUPABASE_ACCESS_TOKEN isn't set, so the egress can't be read."));
      return Promise.resolve({ uncached_bytes: 49452, cached_bytes: 0, ingress_bytes: 42613299, requests: 12677, window_hours: 24, from: null, to: null });
    }),
    readR2Live: vi.fn(() => {
      if (process.env.R2_STATS_FAIL) return Promise.reject(new Error("Supabase answered 404 for blob_mirror_stats."));
      return Promise.resolve({ mirrored_objects: 4000, mirrored_bytes: 250 * 1024 * 1024, pending_objects: 8, pending_bytes: 1024, last_mirrored: null });
    }),
  };
});

const { GET } = await import("./route");
const infra = await import("@/lib/infra-live");

function req(headers: Record<string, string> = { host: "localhost:3457" }) {
  return new Request("http://localhost:3457/api/infra/live", { headers });
}

// The route's answer is a snapshot; typing it here keeps the assertions honest.
async function snapshot(res: Response): Promise<InfraSnapshot> {
  return (await res.json()) as InfraSnapshot;
}

beforeEach(() => {
  delete process.env.R2_STATS_FAIL;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_ACCESS_TOKEN;
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_ACCESS_TOKEN;
});

describe("GET /api/infra/live", () => {
  it("rejects a foreign host", async () => {
    const res = await GET(req({ host: "attacker.test" }));
    expect(res.status).toBe(403);
  });

  it("answers with the whole snapshot when both sources read", async () => {
    process.env.SUPABASE_SECRET_KEY = "sk";
    process.env.SUPABASE_ACCESS_TOKEN = "pat";
    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await snapshot(res);
    expect(json.live?.database_bytes).toBe(171 * 1024 * 1024);
    expect(json.egress?.uncached_bytes).toBe(49452);
    expect(json.quotas.find((r) => r.resource === "Database size")?.nowValue).toBe(171 * 1024 * 1024);
    expect(json.quotas.find((r) => r.resource === "Database size")?.now).toBe("171 MB");
    expect(json.providers.length).toBeGreaterThan(0);
    expect(json.r2?.mirrored_objects).toBe(4000);
    expect(json.providers.find((p) => p.name === "Cloudflare R2")?.state).toBe("live");
    expect(json.quotas.find((r) => r.resource === "R2 storage")?.now).toBe("250 MB");
    expect(json.notes).toEqual([]);
    expect(json.at).toBeTruthy();
  });

  it("notes an unreadable R2 copy and keeps the rest", async () => {
    process.env.SUPABASE_SECRET_KEY = "sk";
    process.env.R2_STATS_FAIL = "1";
    const json = await snapshot(await GET(req()));
    expect(json.r2).toBeNull();
    expect(json.live?.database_bytes).toBe(171 * 1024 * 1024);
    expect(json.notes.join(" ")).toMatch(/R2 copy couldn't be read/);
    expect(json.providers.find((p) => p.name === "Cloudflare R2")?.state).toBe("not used");
    delete process.env.R2_STATS_FAIL;
  });

  it("says a source is unread instead of failing the whole answer", async () => {
    process.env.SUPABASE_SECRET_KEY = "sk";
    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await snapshot(res);
    expect(json.live?.database_bytes).toBe(171 * 1024 * 1024);
    expect(json.egress).toBeNull();
    expect(json.notes.join(" ")).toMatch(/egress/i);
    // And the quota row says "unread" rather than 0.
    expect(json.quotas.find((r) => r.resource === "Egress / month")?.now).toBe("unread");
  });

  it("answers even with no credentials at all", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await snapshot(res);
    expect(json.live).toBeNull();
    expect(json.egress).toBeNull();
    expect(json.notes.length).toBe(2);
    expect(json.notes.join(" ")).toMatch(/SUPABASE_SECRET_KEY/);
    expect(json.notes.join(" ")).toMatch(/SUPABASE_ACCESS_TOKEN/);
  });

  it("reads the key and the token from the environment", async () => {
    process.env.SUPABASE_SECRET_KEY = "sk-env";
    process.env.SUPABASE_ACCESS_TOKEN = "pat-env";
    const res = await GET(req());
    const json = await snapshot(res);
    expect(json.live).not.toBeNull();
    expect(json.egress).not.toBeNull();
    expect(vi.mocked(infra.readInfraLive).mock.calls[0]?.[1]).toBe("sk-env");
    expect(vi.mocked(infra.readEgress).mock.calls[0]?.[1]).toBe("pat-env");
  });
});
