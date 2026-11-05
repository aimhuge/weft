// What Settings → Devices shows for each worker's connectors (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built):
// your grants with their settings, when each was last used, and the projects or cards waiting for an Allow, read as you
// (the account's own client, so RLS shows only yours), plus whether GitHub is connected on weft.zip.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { settingsOf, type GrantSettings } from "./connector-grant";
import { connectUrl, remoteStatus, type ConnectStatus, type RemoteDeps } from "./connector-remote";

export interface PendingAllow {
  kind: "project" | "card";
  subject: string;
  label: string;
}

export interface WorkerConnector {
  grantId: string;
  settings: GrantSettings;
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastRepo: string | null;
  pending: PendingAllow[];
}

export interface ConnectorsView {
  signedIn: boolean;
  github: ConnectStatus & { error?: string };
  connectUrl: string;
  workers: Record<string, WorkerConnector>;
}

interface GrantRow {
  id: string;
  worker_id: string;
  scope: string;
  approval: string;
  lifetime: string;
  asks: string[];
  expires_at: string | null;
  last_used_at: string | null;
}
interface MintRow {
  worker_id: string;
  card_id: string | null;
  repo: string | null;
  outcome: string;
  at: string;
}

const DAY_MS = 24 * 3_600_000;

function pendingFor(grant: GrantRow, mints: MintRow[], allowed: Set<string>, titles: Map<string, string>): PendingAllow[] {
  const s = settingsOf(grant);
  if (s.approval === "worker") return [];
  const out = new Map<string, PendingAllow>();
  for (const m of mints) {
    if (m.worker_id !== grant.worker_id || m.outcome !== "needs_allow") continue;
    const subject = s.approval === "project" ? m.repo : m.card_id;
    if (!subject || allowed.has(`${grant.id}\n${s.approval}\n${subject}`)) continue;
    const label = s.approval === "project" ? subject : (titles.get(subject) ?? subject.slice(0, 8));
    out.set(subject, { kind: s.approval, subject, label });
  }
  return [...out.values()];
}

// The titles of the cards waiting for an Allow, for the menu's "Waiting: card …" lines.
async function cardTitles(client: SupabaseClient, mints: MintRow[]): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  const ids = [...new Set(mints.flatMap((m) => (m.outcome === "needs_allow" && m.card_id ? [m.card_id] : [])))];
  if (!ids.length) return titles;
  const { data } = await client.from("cloud_cards").select("card_id, title:card->>title").in("card_id", ids);
  for (const r of (data ?? []) as { card_id: string; title: string | null }[]) if (r.title) titles.set(r.card_id, r.title);
  return titles;
}

export async function connectorsView(o: { client?: SupabaseClient; remote?: Omit<RemoteDeps, "session">; now?: number } = {}): Promise<ConnectorsView> {
  const client = o.client ?? accountClient();
  const now = o.now ?? Date.now();
  const remote = o.remote ?? { fetchFn: fetch, env: process.env };
  const session = (await client.auth.getSession()) as RemoteDeps["session"];
  const empty: ConnectorsView = { signedIn: false, github: { connected: false }, connectUrl: connectUrl(remote.env), workers: {} };
  if (!session.data.session) return empty;
  const since = new Date(now - DAY_MS).toISOString();
  const [github, grants, mints, allows] = await Promise.all([
    remoteStatus({ ...remote, session }).catch((err: unknown) => ({ connected: false, error: (err as Error).message })),
    client.from("connector_grants").select("id, worker_id, scope, approval, lifetime, asks, expires_at, last_used_at").eq("connector", "github"),
    client.from("connector_mints").select("worker_id, card_id, repo, outcome, at").eq("connector", "github").gte("at", since).order("at", { ascending: false }).limit(200),
    client.from("connector_allows").select("grant_id, kind, subject"),
  ]);
  if (grants.error) throw new Error(`Couldn't read your connectors: ${grants.error.message}`);
  const mintRows = (mints.data ?? []) as MintRow[];
  const allowed = new Set(((allows.data ?? []) as { grant_id: string; kind: string; subject: string }[]).map((a) => `${a.grant_id}\n${a.kind}\n${a.subject}`));
  const titles = await cardTitles(client, mintRows);
  const workers: Record<string, WorkerConnector> = {};
  for (const g of (grants.data as GrantRow[] | null) ?? []) {
    const last = mintRows.find((m) => m.worker_id === g.worker_id && m.outcome === "minted");
    workers[g.worker_id] = { grantId: g.id, settings: settingsOf(g), expiresAt: g.expires_at, lastUsedAt: g.last_used_at, lastRepo: last?.repo ?? null, pending: pendingFor(g, mintRows, allowed, titles) };
  }
  return { ...empty, signedIn: true, github, workers };
}
