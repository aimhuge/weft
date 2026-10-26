import fs from "node:fs";
import path from "node:path";
import { bytesLabel } from "./billing/plans";
import { DATA_DIR } from "./store";

// The live infrastructure numbers behind the repo-analysis report's "Infrastructure & quotas" section
// (docs/architecture/repo-analysis.md).
//
// Three sources, each with its own reach:
//   - Postgres, through `public.infra_live()` (supabase/migrations/20261027094500_infra_live.sql): the
//     database size, the file storage, the table and account counts. Read with the service key, like the
//     Growth data app's reads.
//   - The log stream, through Supabase's Analytics API: the EGRESS. Egress is bytes sent to a client, and
//     the only record of those is the response's content length in the logs — there is no table for it and
//     no Postgres function can see it. The cached and uncached halves are told apart by the CDN's cache
//     status, which is how Supabase bills them separately.
//   - This Mac: the limit windows (lib/limit-history.ts) and the token spend (lib/usage-history.ts).
//
// The report's page fetches this through GET /api/infra/live and patches its numbers in place, so the report
// never goes stale while it is open.
//
// Egress is measured over a window, not all time: the Analytics API keeps a bounded window of logs, so the
// number is "bytes out in the last N hours", and the report says so rather than implying it is a month.

export const INFRA_LIVE_PATH = "/api/infra/live";

/** What `public.infra_live()` returns. Every number is a count or a byte count. */
export interface InfraLive {
  database_bytes: number;
  public_bytes: number;
  table_count: number;
  total_tables: number;
  storage_bytes: number;
  storage_objects: number;
  storage_bucket: string;
  storage_24h_bytes: number;
  storage_24h_objects: number;
  auth_users: number;
  auth_24h: number;
  cloud_cards: number;
  cloud_cards_live: number;
  thread_items: number;
  thread_items_24h: number;
  share_links: number;
  share_visits: number;
  oldest_card: string | null;
}

/** The egress read from the log stream: bytes out, and how they split. */
export interface EgressLive {
  /** Bytes sent to clients, uncached. */
  uncached_bytes: number;
  /** Bytes sent to clients, served by the CDN from cache. Cheaper, and a separate quota. */
  cached_bytes: number;
  /** Bytes sent INTO Supabase. Not egress, but it says the same thing about the traffic. */
  ingress_bytes: number;
  /** The requests behind those numbers. */
  requests: number;
  /** How far back the log window reaches. */
  window_hours: number;
  /** The first and last log line counted. */
  from: string | null;
  to: string | null;
}

/** One provider and what the report says about it. */
export interface ProviderState {
  name: string;
  holds: string;
  /** "live", "linked", "not linked", "not used" — what the report shows in the STATE column. */
  state: "live" | "linked" | "not linked" | "not used";
  detail: string;
}

/** A quota ceiling and what is measured against it. */
export interface QuotaRow {
  resource: string;
  free: string;
  pro: string;
  now: string;
  /** null when the number can't be measured from the Mac. */
  nowValue: number | null;
  /** How full the tightest ceiling is, 0 to 1. null when there's nothing to compare against. */
  fill: number | null;
}

// Supabase's plan ceilings, from the platform's own pricing (docs/guides/platform/manage-your-usage/egress).
// The Free plan's 500 MB database and 1 GB file storage are the platform's limits; Pro's are 8 GB and 100 GB.
export const SUPABASE_FREE = { databaseBytes: 500 * 1024 * 1024, storageBytes: 1024 * 1024 * 1024, egressBytes: 5 * 1024 * 1024 * 1024, authMaus: 50_000 };
export const SUPABASE_PRO = { databaseBytes: 8 * 1024 * 1024 * 1024, storageBytes: 100 * 1024 * 1024 * 1024, egressBytes: 250 * 1024 * 1024 * 1024, authMaus: 100_000 };

/**
 * The quota table: each resource's ceiling on the Free and Pro plans, and the measured value now.
 *
 * The project's own plan tier is NOT known to the Mac: the Supabase Management API needs a personal access
 * token that this build doesn't hold, and the SQL surface has no plan row. So both ceilings are shown and the
 * reader picks — the report says which one applies rather than guessing.
 */
export function quotaRows(live: InfraLive | null, egress: EgressLive | null): QuotaRow[] {
  return [
    byteQuota("Database size", live?.database_bytes ?? null, SUPABASE_FREE.databaseBytes, SUPABASE_PRO.databaseBytes),
    byteQuota("File storage", live?.storage_bytes ?? null, SUPABASE_FREE.storageBytes, SUPABASE_PRO.storageBytes),
    egressQuota(egress),
    authQuota(live),
  ];
}

/** A ceiling measured in bytes, and how full the Free one is. */
function byteQuota(resource: string, value: number | null, freeBytes: number, proBytes: number): QuotaRow {
  return {
    resource,
    free: bytesLabel(freeBytes),
    pro: bytesLabel(proBytes),
    now: value === null ? "unread" : bytesLabel(value),
    nowValue: value,
    fill: value === null ? null : value / freeBytes,
  };
}

/** The egress row: both halves of the bytes out, and the window they were measured over. */
function egressQuota(egress: EgressLive | null): QuotaRow {
  if (!egress) return byteQuota("Egress / month", null, SUPABASE_FREE.egressBytes, SUPABASE_PRO.egressBytes);
  const out = egress.uncached_bytes + egress.cached_bytes;
  return {
    ...byteQuota("Egress / month", out, SUPABASE_FREE.egressBytes, SUPABASE_PRO.egressBytes),
    now: `${bytesLabel(out)} in ${egress.window_hours}h`,
  };
}

/** The Auth row: monthly active users, a count rather than a byte count. */
function authQuota(live: InfraLive | null): QuotaRow {
  const users = live?.auth_users ?? null;
  return {
    resource: "Auth MAUs",
    free: SUPABASE_FREE.authMaus.toLocaleString("en-US"),
    pro: SUPABASE_PRO.authMaus.toLocaleString("en-US"),
    now: users === null ? "unread" : String(users),
    nowValue: users,
    fill: users === null ? null : users / SUPABASE_FREE.authMaus,
  };
}

/**
 * Which providers are in use, read from the artifacts on this Mac rather than from the docs.
 *
 * A provider's state comes from a file that only exists when it is linked: Vercel's project.json, Cloudflare's
 * links.json, BlastCP's links.json. The Supabase project is the one this code is talking to, so it is live by
 * definition. R2 is never in use: it needs a bucket and a client, and neither exists.
 */
export function providerStates(folder: string): ProviderState[] {
  const read = (p: string): Record<string, unknown> | null => {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(p, "utf8"));
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const vercel = read(path.join(folder, ".vercel", "project.json"));
  const cloudflare = read(path.join(path.dirname(folder), ".weft", "cloudflare-links.json")) ?? read(path.join(DATA_DIR, "cloudflare-links.json"));
  const blastcp = read(path.join(DATA_DIR, "blastcp-links.json"));
  const vercelId = typeof vercel?.projectId === "string" ? vercel.projectId : null;
  return [
    { name: "Supabase", holds: "Postgres DB, Storage, Auth", state: "live", detail: "live" },
    { name: "Vercel", holds: "weft.zip — web board, API, CDN", state: vercel ? "live" : "not linked", detail: vercelId ? `live · ${vercelId.slice(0, 10)}…` : "not linked" },
    { name: "Cloudflare", holds: "Workers for Platforms — mini-app code", state: cloudflare ? "linked" : "not linked", detail: cloudflare ? "linked" : "not linked" },
    { name: "Cloudflare R2", holds: "— object storage", state: "not used", detail: "not used" },
    { name: "BlastCP", holds: "social properties", state: blastcp ? "linked" : "not linked", detail: blastcp ? "linked" : "not linked" },
    { name: "Stripe", holds: "billing", state: "live", detail: "live" },
    { name: "Slack", holds: "#user-growth summaries", state: "linked", detail: "linked" },
  ];
}

/** The plan tier is not readable from the Mac; the report says so rather than guessing. */
export function planTierReadable(): false {
  return false;
}

/** The whole live picture, as the route returns it. */
export interface InfraSnapshot {
  at: string;
  live: InfraLive | null;
  egress: EgressLive | null;
  providers: ProviderState[];
  quotas: QuotaRow[];
  /** Set when a source could not be read; the report shows it instead of a blank. */
  notes: string[];
}

/**
 * Calls `public.infra_live()` over PostgREST with the service key.
 *
 * The key is the secret one (`SUPABASE_SECRET_KEY`), not the publishable one: the function is granted to
 * service_role alone, so a signed-in key gets a 401 and no numbers.
 */
export async function readInfraLive(url: string, key: string, fetchImpl: typeof fetch = fetch): Promise<InfraLive> {
  if (!key) throw new Error("SUPABASE_SECRET_KEY isn't set, so the live numbers can't be read.");
  const res = await fetchImpl(`${url.replace(/\/$/, "")}/rest/v1/rpc/infra_live`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Supabase answered ${res.status} for infra_live.`);
  const body = (await res.json()) as InfraLive;
  if (typeof body.database_bytes !== "number") throw new Error("Supabase's infra_live answer wasn't the expected shape.");
  return body;
}

/**
 * Reads the egress out of the log stream.
 *
 * Every log line for a service that answers a client carries the response's content length, and the CDN's
 * cache status. Their sum is the egress: the cached half (`HIT`) is served from the CDN and billed at the
 * lower rate against its own quota; the rest (`DYNAMIC`, and the storage service, which reports its own
 * header names) is uncached.
 *
 * The two services name their headers differently — the edge gateway writes `response.headers.content_length`
 * and the storage service `res.headers.content_length` — so both are read and the first that is there wins.
 */
export function parseEgress(rows: Array<{ source?: string; log_attributes?: Record<string, string> }>): Omit<EgressLive, "window_hours" | "from" | "to"> {
  let uncached = 0;
  let cached = 0;
  let ingress = 0;
  let requests = 0;
  for (const row of rows) {
    const a = row.log_attributes ?? {};
    const bytes = Number(a["response.headers.content_length"] ?? a["res.headers.content_length"] ?? 0);
    const inBytes = Number(a["request.headers.content_length"] ?? a["req.headers.content_length"] ?? 0);
    const status = a["response.headers.cf_cache_status"] ?? a["res.headers.cf_cache_status"] ?? "";
    requests += 1;
    ingress += Number.isFinite(inBytes) ? inBytes : 0;
    if (!Number.isFinite(bytes)) continue;
    if (status === "HIT") cached += bytes;
    else uncached += bytes;
  }
  return { uncached_bytes: uncached, cached_bytes: cached, ingress_bytes: ingress, requests };
}

/**
 * Reads the egress out of Supabase's log stream, over the Analytics API.
 *
 * The endpoint is the one the Supabase MCP's `query_logs` uses: the project's logs, as JSON lines. The
 * personal access token is a Management API credential (`SUPABASE_ACCESS_TOKEN`), not the project's key —
 * the logs are not readable with the service key.
 *
 * The window is what the log store keeps, so the answer is "bytes out in the last N hours" and never a
 * month: the report says which window it read.
 */
export async function readEgress(projectRef: string, token: string, hours = 24, fetchImpl: typeof fetch = fetch): Promise<EgressLive> {
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN isn't set, so the egress can't be read.");
  const to = new Date();
  const from = new Date(to.getTime() - hours * 60 * 60 * 1000);
  const url = `https://api.supabase.com/v1/projects/${projectRef}/analytics/endpoints/logs.all`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql: "select source, log_attributes from logs", start_time: from.toISOString(), end_time: to.toISOString() }),
  });
  if (!res.ok) throw new Error(`Supabase's log stream answered ${res.status}.`);
  const rows = (await res.json()) as Array<{ source?: string; log_attributes?: Record<string, string> }>;
  const parsed = parseEgress(Array.isArray(rows) ? rows : []);
  return { ...parsed, window_hours: hours, from: from.toISOString(), to: to.toISOString() };
}

