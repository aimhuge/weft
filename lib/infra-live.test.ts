// The live infrastructure numbers behind the repo-analysis report (docs/architecture/repo-analysis.md).
//
// The tests cover the two places a wrong number would be invisible: the egress parser, which has
// to tell the CDN's cached half from the uncached half (Supabase bills them apart), and the quota
// table, which has to say "unread" rather than "zero" when a source could not be read.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEgress, providerStates, quotaRows, readEgress, readInfraLive, SUPABASE_FREE, type EgressLive, type InfraLive } from "./infra-live";

function live(over: Partial<InfraLive> = {}): InfraLive {
  return {
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
    ...over,
  };
}

/**
 * A fetch stub that answers with a JSON body, plus the calls it recorded.
 *
 * A plain function rather than `vi.fn`, so the stub's own type stays resolvable: `vi.fn`'s
 * overloads lose the argument types when the implementation is cast straight to `typeof fetch`.
 */
function stubFetch(answer: (url: string, init: RequestInit) => { ok: boolean; status: number; json: () => Promise<unknown> }) {
  const calls: Array<[string, RequestInit]> = [];
  const fetchImpl = (url: string, init: RequestInit) => {
    calls.push([url, init]);
    return Promise.resolve(answer(url, init));
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe("parseEgress", () => {
  it("splits the bytes out by the CDN's cache status", () => {
    const out = parseEgress([
      { source: "edge_logs", log_attributes: { "response.headers.content_length": "1000", "response.headers.cf_cache_status": "HIT" } },
      { source: "edge_logs", log_attributes: { "response.headers.content_length": "2500", "response.headers.cf_cache_status": "DYNAMIC" } },
    ]);
    expect(out.cached_bytes).toBe(1000);
    expect(out.uncached_bytes).toBe(2500);
    expect(out.requests).toBe(2);
  });

  it("reads the storage service's own header name", () => {
    const out = parseEgress([
      { source: "storage_logs", log_attributes: { "res.headers.content_length": "400" } },
    ]);
    expect(out.uncached_bytes).toBe(400);
    expect(out.cached_bytes).toBe(0);
  });

  it("counts the bytes in as well as out", () => {
    const out = parseEgress([
      { log_attributes: { "request.headers.content_length": "900", "response.headers.content_length": "10" } },
    ]);
    expect(out.ingress_bytes).toBe(900);
    expect(out.uncached_bytes).toBe(10);
  });

  it("counts every request, even one with no length at all", () => {
    const out = parseEgress([
      { log_attributes: {} },
      { log_attributes: { "response.headers.content_length": "12" } },
    ]);
    expect(out.requests).toBe(2);
    expect(out.uncached_bytes).toBe(12);
  });

  it("ignores a length that isn't a number", () => {
    const out = parseEgress([{ log_attributes: { "response.headers.content_length": "not a number" } }]);
    expect(out.uncached_bytes).toBe(0);
    expect(out.ingress_bytes).toBe(0);
  });

  it("answers zeroes for no rows", () => {
    expect(parseEgress([])).toEqual({ uncached_bytes: 0, cached_bytes: 0, ingress_bytes: 0, requests: 0 });
  });
});

describe("readEgress", () => {
  it("asks the Analytics API for the window and reads the rows back", async () => {
    const { fetchImpl, calls } = stubFetch(() => ({
      ok: true,
      status: 200,
      json: () => Promise.resolve([{ source: "edge_logs", log_attributes: { "response.headers.content_length": "5" } }]),
    }));

    const out = await readEgress("proj-ref", "pat", 24, fetchImpl);
    expect(out.uncached_bytes).toBe(5);
    expect(out.window_hours).toBe(24);
    expect(out.requests).toBe(1);
    expect(calls[0]?.[0]).toBe("https://api.supabase.com/v1/projects/proj-ref/analytics/endpoints/logs.all");
    expect((calls[0]?.[1]?.headers as Record<string, string>).Authorization).toBe("Bearer pat");
    const body = JSON.parse(calls[0]?.[1]?.body as string) as { start_time: string; end_time: string };
    expect(body.start_time).toBeTruthy();
    expect(body.end_time).toBeTruthy();
  });

  it("says so when the log stream refuses", async () => {
    const { fetchImpl } = stubFetch(() => ({ ok: false, status: 401, json: () => Promise.resolve({}) }));
    await expect(readEgress("proj-ref", "pat", 24, fetchImpl)).rejects.toThrow(/401/);
  });

  it("refuses to try without a token", async () => {
    const { fetchImpl } = stubFetch(() => ({ ok: true, status: 200, json: () => Promise.resolve({}) }));
    await expect(readEgress("proj-ref", "", 24, fetchImpl)).rejects.toThrow(/SUPABASE_ACCESS_TOKEN/);
  });
});

describe("readInfraLive", () => {
  it("calls the function over PostgREST with the service key", async () => {
    const { fetchImpl, calls } = stubFetch(() => ({ ok: true, status: 200, json: () => Promise.resolve(live()) }));

    const out = await readInfraLive("https://abc.supabase.co/", "sk-secret", fetchImpl);
    expect(out.database_bytes).toBe(171 * 1024 * 1024);
    expect(calls[0]?.[0]).toBe("https://abc.supabase.co/rest/v1/rpc/infra_live");
    const headers = calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.apikey).toBe("sk-secret");
    expect(headers.Authorization).toBe("Bearer sk-secret");
  });

  it("says so when the key is wrong", async () => {
    const { fetchImpl } = stubFetch(() => ({ ok: false, status: 401, json: () => Promise.resolve({}) }));
    await expect(readInfraLive("https://abc.supabase.co", "bad", fetchImpl)).rejects.toThrow(/401/);
  });

  it("refuses to try without a key", async () => {
    const { fetchImpl } = stubFetch(() => ({ ok: true, status: 200, json: () => Promise.resolve({}) }));
    await expect(readInfraLive("https://abc.supabase.co", "", fetchImpl)).rejects.toThrow(/SUPABASE_SECRET_KEY/);
  });

  it("rejects an answer that isn't the shape it expects", async () => {
    const { fetchImpl } = stubFetch(() => ({ ok: true, status: 200, json: () => Promise.resolve({ nope: 1 }) }));
    await expect(readInfraLive("https://abc.supabase.co", "sk", fetchImpl)).rejects.toThrow(/shape/);
  });
});

describe("quotaRows", () => {
  it("measures the database against the Free ceiling", () => {
    const rows = quotaRows(live(), null);
    const db = rows.find((r) => r.resource === "Database size")!;
    expect(db.nowValue).toBe(171 * 1024 * 1024);
    expect(db.fill).toBeCloseTo((171 * 1024 * 1024) / SUPABASE_FREE.databaseBytes, 5);
    expect(db.free).toBe("500 MB");
    expect(db.pro).toBe("8 GB");
  });

  it("says unread rather than zero when the source couldn't be read", () => {
    const rows = quotaRows(null, null);
    for (const row of rows) {
      expect(row.now).toBe("unread");
      expect(row.nowValue).toBeNull();
      expect(row.fill).toBeNull();
    }
  });

  it("adds the cached and uncached halves into one egress number", () => {
    const eg: EgressLive = { uncached_bytes: 100, cached_bytes: 50, ingress_bytes: 900, requests: 3, window_hours: 24, from: null, to: null };
    const rows = quotaRows(live(), eg);
    const out = rows.find((r) => r.resource === "Egress / month")!;
    expect(out.nowValue).toBe(150);
    expect(out.now).toContain("24h");
  });

  it("keeps the Auth row on the number of accounts", () => {
    const rows = quotaRows(live({ auth_users: 5 }), null);
    const auth = rows.find((r) => r.resource === "Auth MAUs")!;
    expect(auth.now).toBe("5");
    expect(auth.nowValue).toBe(5);
    expect(auth.fill).toBeCloseTo(5 / SUPABASE_FREE.authMaus, 8);
  });
});

describe("providerStates", () => {
  it("calls Supabase and Stripe live — they are what this code talks to", () => {
    const states = providerStates(process.cwd());
    const supabase = states.find((s) => s.name === "Supabase")!;
    expect(supabase.state).toBe("live");
    const stripe = states.find((s) => s.name === "Stripe")!;
    expect(stripe.state).toBe("live");
  });

  it("never calls R2 in use — it has no bucket and no client", () => {
    const states = providerStates(process.cwd());
    expect(states.find((s) => s.name === "Cloudflare R2")!.state).toBe("not used");
  });

  it("reads a folder with no provider links and says so", () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "weft-prov-"));
    try {
      const states = providerStates(folder);
      expect(states.find((s) => s.name === "Vercel")!.state).toBe("not linked");
      expect(states.find((s) => s.name === "Cloudflare")!.state).toBe("not linked");
      expect(states.find((s) => s.name === "BlastCP")!.state).toBe("not linked");
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});
