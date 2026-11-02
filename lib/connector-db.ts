// The rows weft.zip's connector minter reads and writes, over the service-role client
// (supabase/migrations/20261102280000_worker_github_mint.sql). One narrow interface, so the minter's decisions
// (lib/connector-mint.ts, lib/connector-tokens.ts, lib/connector-revoke.ts) are tested against a plain fake and this
// file only maps each call to its query. Server-only: the service role bypasses RLS.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface WorkerRow {
  id: string;
  org_id: string;
  owner_user: string;
  name: string;
  sign_key: string | null;
  revoked_at: string | null;
}

export interface GrantRow {
  id: string;
  user_id: string;
  worker_id: string;
  connector: string;
  scope: string;
  approval: string;
  lifetime: string;
  asks: string[];
  expires_at: string | null;
  last_used_at: string | null;
}

export interface TokenRow {
  user_id: string;
  github_id: number;
  github_login: string;
  refresh_sealed: string;
  refresh_expires_at: string;
  access_sealed: string | null;
  access_issued_at: string | null;
  access_expires_at: string | null;
}

export interface StartRow {
  kind: string;
  folder: string;
  payload: unknown;
  created_by: string;
}

export interface PinnedCard {
  user_id: string;
  folder: string;
  repo: string;
}

export interface LiveToken {
  id: string;
  subject: string;
  repo: string;
  token_sealed: string;
  issued_at: string;
  expires_at: string | null;
}

export interface MintLog {
  user_id: string;
  worker_id: string;
  grant_id: string | null;
  connector: string;
  card_id: string | null;
  repo: string | null;
  outcome: "minted" | "refused" | "needs_allow" | "revoked";
  reason: string | null;
  token_kind: "user" | "scoped" | null;
  nonce: string | null;
}

export interface ConnectorDb {
  workerByKeyHash(hash: string): Promise<WorkerRow | null>;
  workerById(id: string): Promise<WorkerRow | null>;
  grant(userId: string, workerId: string, connector: string): Promise<GrantRow | null>;
  touchGrant(id: string, at: string): Promise<void>;
  deleteGrants(userId: string, connector: string, workerId?: string): Promise<number>;
  hasAllow(grantId: string, kind: string, subject: string): Promise<boolean>;
  starts(workerId: string, cardId: string, userId: string): Promise<StartRow[]>;
  pinnedCard(workerId: string, cardId: string): Promise<PinnedCard | null>;
  pinCard(workerId: string, cardId: string, card: PinnedCard): Promise<void>;
  cardState(orgId: string, cardId: string): Promise<{ deleted: boolean; column: string | null } | null>;
  mintsSince(workerId: string, since: string, kind?: "user"): Promise<number>;
  // Logs a request; "replay" when that nonce was logged for the worker already. Returns the row's id.
  logMint(row: MintLog): Promise<number | "replay">;
  finishMint(id: number, patch: Partial<MintLog>): Promise<void>;
  tokens(userId: string): Promise<TokenRow | null>;
  saveTokens(row: Partial<TokenRow> & { user_id: string; refreshing_until?: string | null }): Promise<void>;
  deleteTokens(userId: string): Promise<void>;
  // Takes the user's refresh for a while; false when another mint is refreshing it now.
  claimRefresh(userId: string, now: string, until: string): Promise<boolean>;
  liveToken(workerId: string, subject: string): Promise<LiveToken | null>;
  saveLiveToken(row: { user_id: string; worker_id: string; subject: string; repo: string; token_sealed: string; issued_at: string; expires_at: string | null }): Promise<void>;
  liveTokens(filter: { workerId?: string; userId?: string }): Promise<LiveToken[]>;
  dropLiveTokens(ids: string[]): Promise<void>;
}

type R = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };

// The part of supabase-js's query builder this file uses, so each call stays typed without the generated schema.
interface Q extends PromiseLike<R> {
  select(columns: string, options?: object): Q;
  insert(row: object): Q;
  update(row: object): Q;
  upsert(row: object, options?: object): Q;
  delete(): Q;
  eq(column: string, value: unknown): Q;
  gte(column: string, value: unknown): Q;
  in(column: string, values: unknown[]): Q;
  or(filter: string): Q;
  limit(n: number): Q;
  maybeSingle(): PromiseLike<R>;
  single(): PromiseLike<R>;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the row type its select returns
function must<T>(r: R, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

const WORKER = "id, org_id, owner_user, name, sign_key, revoked_at";
const GRANT = "id, user_id, worker_id, connector, scope, approval, lifetime, asks, expires_at, last_used_at";
const TOKENS = "user_id, github_id, github_login, refresh_sealed, refresh_expires_at, access_sealed, access_issued_at, access_expires_at";
const LIVE = "id, subject, repo, token_sealed, issued_at, expires_at";

export function supabaseConnectorDb(db: SupabaseClient): ConnectorDb {
  const t = (name: string) => db.from(name) as unknown as Q;
  return {
    async workerByKeyHash(hash) {
      return must<WorkerRow | null>(await t("cloud_workers").select(WORKER).eq("key_hash", hash).eq("kind", "headless").maybeSingle(), "Reading the worker");
    },
    async workerById(id) {
      return must<WorkerRow | null>(await t("cloud_workers").select(WORKER).eq("id", id).eq("kind", "headless").maybeSingle(), "Reading the worker");
    },
    async grant(userId, workerId, connector) {
      return must<GrantRow | null>(await t("connector_grants").select(GRANT).eq("user_id", userId).eq("worker_id", workerId).eq("connector", connector).maybeSingle(), "Reading the grant");
    },
    async touchGrant(id, at) {
      must(await t("connector_grants").update({ last_used_at: at }).eq("id", id), "Marking the grant used");
    },
    async deleteGrants(userId, connector, workerId) {
      let q = t("connector_grants").delete().eq("user_id", userId).eq("connector", connector);
      if (workerId) q = q.eq("worker_id", workerId);
      return (must<unknown[] | null>(await q.select("id"), "Deleting the grant") ?? []).length;
    },
    async hasAllow(grantId, kind, subject) {
      return (must<unknown[] | null>(await t("connector_allows").select("id").eq("grant_id", grantId).eq("kind", kind).eq("subject", subject).limit(1), "Reading the Allow") ?? []).length > 0;
    },
    async starts(workerId, cardId, userId) {
      const q = t("cloud_commands").select("kind, folder, payload, created_by").eq("target_device", `worker:${workerId}`).eq("card_id", cardId).eq("created_by", userId).in("kind", ["new_card", "run", "host"]);
      return must<StartRow[] | null>(await q, "Reading the card's start") ?? [];
    },
    async pinnedCard(workerId, cardId) {
      return must<PinnedCard | null>(await t("connector_cards").select("user_id, folder, repo").eq("worker_id", workerId).eq("card_id", cardId).maybeSingle(), "Reading the card");
    },
    async pinCard(workerId, cardId, card) {
      must(await t("connector_cards").upsert({ worker_id: workerId, card_id: cardId, ...card }, { onConflict: "worker_id,card_id", ignoreDuplicates: true }), "Pinning the card");
    },
    async cardState(orgId, cardId) {
      const row = must<{ deleted: boolean; col: string | null } | null>(await t("cloud_cards").select("deleted, col:card->>column").eq("org_id", orgId).eq("card_id", cardId).maybeSingle(), "Reading the card");
      return row ? { deleted: row.deleted, column: row.col } : null;
    },
    async mintsSince(workerId, since, kind) {
      let q = t("connector_mints").select("id", { count: "exact", head: true }).eq("worker_id", workerId).gte("at", since);
      if (kind) q = q.eq("token_kind", kind).eq("outcome", "minted");
      const r = await q;
      must(r, "Counting mints");
      return r.count ?? 0;
    },
    async logMint(row) {
      const r = await t("connector_mints").insert(row).select("id").single();
      if (r.error?.code === "23505") return "replay";
      return must<{ id: number }>(r, "Logging the request").id;
    },
    async finishMint(id, patch) {
      must(await t("connector_mints").update(patch).eq("id", id), "Logging the answer");
    },
    async tokens(userId) {
      return must<TokenRow | null>(await t("connector_github_tokens").select(TOKENS).eq("user_id", userId).maybeSingle(), "Reading your GitHub sign-in");
    },
    async saveTokens(row) {
      must(await t("connector_github_tokens").upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "user_id" }), "Saving your GitHub sign-in");
    },
    async deleteTokens(userId) {
      must(await t("connector_github_tokens").delete().eq("user_id", userId), "Forgetting your GitHub sign-in");
    },
    async claimRefresh(userId, now, until) {
      const q = t("connector_github_tokens").update({ refreshing_until: until }).eq("user_id", userId).or(`refreshing_until.is.null,refreshing_until.lt.${now}`).select("user_id");
      return (must<unknown[] | null>(await q, "Claiming the refresh") ?? []).length > 0;
    },
    async liveToken(workerId, subject) {
      return must<LiveToken | null>(await t("connector_live_tokens").select(LIVE).eq("worker_id", workerId).eq("subject", subject).maybeSingle(), "Reading the token");
    },
    async saveLiveToken(row) {
      must(await t("connector_live_tokens").upsert(row, { onConflict: "worker_id,subject" }), "Saving the token");
    },
    async liveTokens({ workerId, userId }) {
      let q = t("connector_live_tokens").select(LIVE);
      if (workerId) q = q.eq("worker_id", workerId);
      if (userId) q = q.eq("user_id", userId);
      return must<LiveToken[] | null>(await q, "Reading the live tokens") ?? [];
    },
    async dropLiveTokens(ids) {
      if (ids.length) must(await t("connector_live_tokens").delete().in("id", ids), "Dropping the tokens");
    },
  };
}
