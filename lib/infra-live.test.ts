// The live infrastructure numbers behind the repo-analysis report (docs/architecture/repo-analysis.md).
//
// The tests cover the two places a wrong number would be invisible: the egress parser, which has
// to tell the CDN's cached half from the uncached half (Supabase bills them apart), and the quota
// table, which has to say "unread" rather than "zero" when a source could not be read.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EGRESS_SQL, parseEgress, providerStates, quotaRows, R2_FREE_BYTES, readEgress, readInfraLive, readR2Live, SUPABASE_FREE, type EgressLive, type InfraLive, type R2Live } from "./infra-live";

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
      { source: "edge_logs", cache: "HIT", requests: 2, out_bytes: 1000, in_bytes: 0 },
      { source: "edge_logs", cache: "DYNAMIC", requests: 3, out_bytes: 2500, in_bytes: 0 },
      { source: "edge_logs", cache: "MISS", requests: 1, out_bytes: 7000, in_bytes: 0 },
    ]);
    expect(out.cached_bytes).toBe(1000);
    expect(out.uncached_bytes).toBe(9500);
    expect(out.requests).toBe(6);
  });

  it("counts a row with no cache status as uncached", () => {
    const out = parseEgress([{ source: "storage_logs", cache: "", requests: 1, out_bytes: 400 }]);
    expect(out.uncached_bytes).toBe(400);
    expect(out.cached_bytes).toBe(0);
  });

  it("counts the bytes in as well as out, as numbers or strings", () => {
    const out = parseEgress([{ requests: "4", in_bytes: "900", out_bytes: "10" }]);
    expect(out.ingress_bytes).toBe(900);
    expect(out.uncached_bytes).toBe(10);
    expect(out.requests).toBe(4);
  });

  it("ignores a value that isn't a number, and a missing one", () => {
    const out = parseEgress([{ out_bytes: "not a number" }, {}]);
    expect(out.uncached_bytes).toBe(0);
    expect(out.ingress_bytes).toBe(0);
    expect(out.requests).toBe(0);
  });

  it("answers zeroes for no rows", () => {
    expect(parseEgress([])).toEqual({ uncached_bytes: 0, cached_bytes: 0, ingress_bytes: 0, requests: 0 });
  });
});

describe("readEgress", () => {
  it("asks the logs endpoint to sum the window, and reads the sums back", async () => {
    const { fetchImpl, calls } = stubFetch(() => ({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ result: [{ source: "edge_logs", cache: "MISS", requests: 1, out_bytes: 5, in_bytes: 0 }] }),
    }));

    const out = await readEgress("proj-ref", "pat", 24, fetchImpl);
    expect(out.uncached_bytes).toBe(5);
    expect(out.window_hours).toBe(24);
    expect(out.requests).toBe(1);
    const url = new URL(calls[0]?.[0] as string);
    expect(url.origin + url.pathname).toBe("https://api.supabase.com/v1/projects/proj-ref/analytics/endpoints/logs");
    expect(url.searchParams.get("sql")).toBe(EGRESS_SQL);
    expect(url.searchParams.get("iso_timestamp_start")).toBeTruthy();
    expect(url.searchParams.get("iso_timestamp_end")).toBeTruthy();
    expect((calls[0]?.[1]?.headers as Record<string, string>).Authorization).toBe("Bearer pat");
  });

  it("reads no result as zeroes", async () => {
    const { fetchImpl } = stubFetch(() => ({ ok: true, status: 200, json: () => Promise.resolve({}) }));
    const out = await readEgress("proj-ref", "pat", 24, fetchImpl);
    expect(out.requests).toBe(0);
  });

  it("says so when the log stream refuses the query with a 200", async () => {
    const { fetchImpl } = stubFetch(() => ({ ok: true, status: 200, json: () => Promise.resolve({ error: 'Field "x" does not exist.' }) }));
    await expect(readEgress("proj-ref", "pat", 24, fetchImpl)).rejects.toThrow(/Field "x" does not exist/);
  });

  it("names an error that isn't a string", async () => {
    const { fetchImpl } = stubFetch(() => ({ ok: true, status: 200, json: () => Promise.resolve({ error: { code: 400 } }) }));
    await expect(readEgress("proj-ref", "pat", 24, fetchImpl)).rejects.toThrow(/"code":400/);
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

function r2Live(over: Partial<R2Live> = {}): R2Live {
  return { mirrored_objects: 4500, mirrored_bytes: 264 * 1024 * 1024, pending_objects: 8, pending_bytes: 1024, last_mirrored: "2026-10-29T10:00:00Z", ...over };
}

describe("readR2Live", () => {
  it("POSTs blob_mirror_stats over PostgREST with the service key", async () => {
    const { fetchImpl, calls } = stubFetch(() => ({ ok: true, status: 200, json: () => Promise.resolve(r2Live()) }));
    expect((await readR2Live("https://abc.supabase.co/", "sk", fetchImpl)).mirrored_objects).toBe(4500);
    expect(calls[0]?.[0]).toBe("https://abc.supabase.co/rest/v1/rpc/blob_mirror_stats");
    expect(calls[0]?.[1]?.method).toBe("POST");
  });

  it("says so on a refusal or an odd answer", async () => {
    const refused = stubFetch(() => ({ ok: false, status: 404, json: () => Promise.resolve({}) }));
    await expect(readR2Live("https://abc.supabase.co", "sk", refused.fetchImpl)).rejects.toThrow(/404/);
    const odd = stubFetch(() => ({ ok: true, status: 200, json: () => Promise.resolve({ nope: 1 }) }));
    await expect(readR2Live("https://abc.supabase.co", "sk", odd.fetchImpl)).rejects.toThrow(/expected shape/);
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
  it("adds R2's storage against its 10 GB free tier once something is copied", () => {
    expect(quotaRows(live(), null).some((r) => r.resource === "R2 storage")).toBe(false);
    expect(quotaRows(live(), null, r2Live({ mirrored_objects: 0 })).some((r) => r.resource === "R2 storage")).toBe(false);
    const row = quotaRows(live(), null, r2Live()).find((r) => r.resource === "R2 storage")!;
    expect(row.now).toBe("264 MB");
    expect(row.pro).toBe("$0.015/GB-mo");
    expect(row.fill).toBeCloseTo((264 * 1024 * 1024) / R2_FREE_BYTES, 8);
  });

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

  it("calls R2 not used until the first blob is copied there", () => {
    expect(providerStates(process.cwd()).find((s) => s.name === "Cloudflare R2")).toMatchObject({ state: "not used", detail: "not used" });
    const empty = providerStates(process.cwd(), r2Live({ mirrored_objects: 0, mirrored_bytes: 0, pending_objects: 4508 }));
    expect(empty.find((s) => s.name === "Cloudflare R2")).toMatchObject({ state: "not used", detail: "not used · 4508 to copy" });
  });

  it("calls R2 live with what's copied and what's left", () => {
    const r2 = providerStates(process.cwd(), r2Live()).find((s) => s.name === "Cloudflare R2")!;
    expect(r2.state).toBe("live");
    expect(r2.detail).toBe("live · 4500 objects, 264 MB · 8 to copy");
    const done = providerStates(process.cwd(), r2Live({ pending_objects: 0 })).find((s) => s.name === "Cloudflare R2")!;
    expect(done.detail).toBe("live · 4500 objects, 264 MB");
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
