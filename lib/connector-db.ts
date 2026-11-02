// The rows weft.zip's connector minter reads and writes, over the service-role client
// (supabase/migrations/20261102280000_worker_github_mint.sql). One narrow interface, so the minter's decisions
// (lib/connector-mint.ts, lib/connector-tokens.ts, lib/connector-revoke.ts) are tested against a plain fake and this
// file only maps each call to its query. The signers, pins and signed writes are lib/connector-db-trust.ts's.
// Server-only: the service role bypasses RLS.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { must, supabaseTrustDb, type Q, type TrustDb } from "./connector-db-trust";

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
  repos: string[];
  signer_id: string | null;
  sig: string;
  nonce: string;
  issued_at: string;
  epoch: number;
  expires_at: string | null;
  last_used_at: string | null;
}

export interface AllowRow {
  grant_id: string;
  kind: string;
  subject: string;
  signer_id: string | null;
  sig: string;
  nonce: string;
  issued_at: string;
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
  disconnect_pending_at?: string | null;
}

export interface StartRow {
  kind: string;
  folder: string;
  payload: unknown;
  created_by: string;
  created_at?: string;
}

export interface PinnedCard {
  user_id: string;
  folder: string;
  repo: string;
  // The Mac key that signed the card's start, and that signature's sha256 (one card per signature).
  signer_id: string | null;
  start_sig: string | null;
  closed_at?: string | null;
}

export interface LiveToken {
  id: string;
  user_id?: string;
  worker_id?: string;
  subject: string;
  repo: string;
  token_sealed: string;
  issued_at: string;
  expires_at: string | null;
}

export interface MintLog {
  user_id: string;
  worker_id: string | null;
  grant_id: string | null;
  connector: string;
  card_id: string | null;
  repo: string | null;
  outcome: "minted" | "refused" | "needs_allow" | "revoked" | "notice";
  reason: string | null;
  token_kind: "user" | "scoped" | null;
  token_issued_at?: string | null;
  nonce: string | null;
}

export interface MintLimits {
  workerMinute: number;
  workerHour: number;
  userMinute: number;
  userHour: number;
}

export interface ConnectorDb extends TrustDb {
  workerByKeyHash(hash: string): Promise<WorkerRow | null>;
  workerById(id: string): Promise<WorkerRow | null>;
  grant(userId: string, workerId: string, connector: string): Promise<GrantRow | null>;
  grantById(id: string): Promise<GrantRow | null>;
  expiredGrants(now: string): Promise<GrantRow[]>;
  grantsBySigner(signerId: string): Promise<GrantRow[]>;
  touchGrant(id: string, at: string): Promise<void>;
  deleteGrants(userId: string, connector: string, workerId?: string): Promise<number>;
  allow(grantId: string, kind: string, subject: string): Promise<AllowRow | null>;
  starts(workerId: string, cardId: string, userId: string): Promise<StartRow[]>;
  pinnedCard(workerId: string, cardId: string): Promise<PinnedCard | null>;
  // Pins a card to its start; false when the card is pinned already or the start's signature pinned another card.
  pinCard(workerId: string, cardId: string, card: PinnedCard): Promise<boolean>;
  // Closes a card's pin for good (it was Done or deleted).
  closePin(workerId: string, cardId: string, at: string): Promise<void>;
  cardState(orgId: string, workerId: string, cardId: string): Promise<{ deleted: boolean; column: string | null } | null>;
  // Logs a request under its nonce and the rate limits, in one step: its id, "replay" or "limited".
  admitMint(row: MintLog, limits: MintLimits): Promise<number | "replay" | "limited">;
  // Whether the worker was handed the user access token issued at `issuedAt`.
  handedUser(workerId: string, issuedAt: string): Promise<boolean>;
  logMint(row: MintLog): Promise<void>;
  finishMint(id: number, patch: Partial<MintLog>): Promise<void>;
  tokens(userId: string): Promise<TokenRow | null>;
  pendingDisconnects(): Promise<TokenRow[]>;
  saveTokens(row: Partial<TokenRow> & { user_id: string; refreshing_until?: string | null }): Promise<void>;
  deleteTokens(userId: string): Promise<void>;
  // Takes the user's refresh for a while; false when another mint (or a revoke) is refreshing it now.
  claimRefresh(userId: string, now: string, until: string): Promise<boolean>;
  // Takes the making of a narrowed token for (worker, subject) for a while; false when another mint has it now.
  claimLive(workerId: string, subject: string, now: string, until: string): Promise<boolean>;
  releaseLive(workerId: string, subject: string): Promise<void>;
  liveToken(workerId: string, subject: string): Promise<LiveToken | null>;
  saveLiveToken(row: { user_id: string; worker_id: string; subject: string; repo: string; token_sealed: string; issued_at: string; expires_at: string | null }): Promise<void>;
  liveTokens(filter: { workerId?: string; userId?: string }): Promise<LiveToken[]>;
  dropLiveTokens(ids: string[]): Promise<void>;
}

const WORKER = "id, org_id, owner_user, name, sign_key, revoked_at";
const GRANT = "id, user_id, worker_id, connector, scope, approval, lifetime, asks, repos, signer_id, sig, nonce, issued_at, epoch, expires_at, last_used_at";
const TOKENS = "user_id, github_id, github_login, refresh_sealed, refresh_expires_at, access_sealed, access_issued_at, access_expires_at, disconnect_pending_at";
const LIVE = "id, user_id, worker_id, subject, repo, token_sealed, issued_at, expires_at";
const ALLOW = "grant_id, kind, subject, signer_id, sig, nonce, issued_at";
// How many rows a sweep or a listing reads at once; the daily sweep catches the rest next time.
const BATCH = 500;

// The start commands for a card: a host card.create names its card in its args (the owner wrote it); a run or new_card
// gets its card id from the worker's report, which can no longer re-point one (worker_report). cardId is CARD_RE-checked.
const startsFilter = (cardId: string) => `and(kind.eq.host,payload->args->>id.eq.${cardId}),and(kind.in.(new_card,run),card_id.eq.${cardId})`;

export function supabaseConnectorDb(db: SupabaseClient): ConnectorDb {
  const t = (name: string) => db.from(name) as unknown as Q;
  const rpc = (fn: string, args: object) => db.rpc(fn, args) as unknown as PromiseLike<{ data: unknown; error: { message: string } | null }>;
  return {
    ...supabaseTrustDb(db),
    async workerByKeyHash(hash) {
      return must<WorkerRow | null>(await t("cloud_workers").select(WORKER).eq("key_hash", hash).eq("kind", "headless").maybeSingle(), "Reading the worker");
    },
    async workerById(id) {
      return must<WorkerRow | null>(await t("cloud_workers").select(WORKER).eq("id", id).eq("kind", "headless").maybeSingle(), "Reading the worker");
    },
    async grant(userId, workerId, connector) {
      return must<GrantRow | null>(await t("connector_grants").select(GRANT).eq("user_id", userId).eq("worker_id", workerId).eq("connector", connector).maybeSingle(), "Reading the grant");
    },
    async grantById(id) {
      return must<GrantRow | null>(await t("connector_grants").select(GRANT).eq("id", id).maybeSingle(), "Reading the grant");
    },
    async expiredGrants(now) {
      return must<GrantRow[] | null>(await t("connector_grants").select(GRANT).lt("expires_at", now).limit(BATCH), "Reading expired grants") ?? [];
    },
    async grantsBySigner(signerId) {
      return must<GrantRow[] | null>(await t("connector_grants").select(GRANT).eq("signer_id", signerId), "Reading the grants") ?? [];
    },
    async touchGrant(id, at) {
      must(await t("connector_grants").update({ last_used_at: at }).eq("id", id), "Marking the grant used");
    },
    async deleteGrants(userId, connector, workerId) {
      let q = t("connector_grants").delete().eq("user_id", userId).eq("connector", connector);
      if (workerId) q = q.eq("worker_id", workerId);
      return (must<unknown[] | null>(await q.select("id"), "Deleting the grant") ?? []).length;
    },
    async allow(grantId, kind, subject) {
      return must<AllowRow | null>(await t("connector_allows").select(ALLOW).eq("grant_id", grantId).eq("kind", kind).eq("subject", subject).maybeSingle(), "Reading the Allow");
    },
    async starts(workerId, cardId, userId) {
      const q = t("cloud_commands").select("kind, folder, payload, created_by, created_at").eq("target_device", `worker:${workerId}`).eq("created_by", userId).or(startsFilter(cardId)).order("created_at", { ascending: true });
      return must<StartRow[] | null>(await q, "Reading the card's start") ?? [];
    },
    async pinnedCard(workerId, cardId) {
      return must<PinnedCard | null>(await t("connector_cards").select("user_id, folder, repo, signer_id, start_sig, closed_at").eq("worker_id", workerId).eq("card_id", cardId).maybeSingle(), "Reading the card");
    },
    async pinCard(workerId, cardId, card) {
      const r = await t("connector_cards").insert({ worker_id: workerId, card_id: cardId, ...card });
      if (r.error?.code === "23505") return false;
      must(r, "Pinning the card");
      return true;
    },
    async closePin(workerId, cardId, at) {
      must(await t("connector_cards").update({ closed_at: at }).eq("worker_id", workerId).eq("card_id", cardId), "Closing the card's pin");
    },
    async cardState(orgId, workerId, cardId) {
      const q = t("cloud_cards").select("deleted, col:card->>column").eq("org_id", orgId).eq("owner_worker", workerId).eq("card_id", cardId).maybeSingle();
      const row = must<{ deleted: boolean; col: string | null } | null>(await q, "Reading the card");
      return row ? { deleted: row.deleted, column: row.col } : null;
    },
    async admitMint(row, l) {
      const id = must<number>(await rpc("connector_mint_admit", { p_row: row, p_worker_minute: l.workerMinute, p_worker_hour: l.workerHour, p_user_minute: l.userMinute, p_user_hour: l.userHour }), "Logging the request");
      return id === -1 ? "replay" : id === -2 ? "limited" : id;
    },
    async handedUser(workerId, issuedAt) {
      const q = t("connector_mints").select("id").eq("worker_id", workerId).eq("outcome", "minted").eq("token_kind", "user").eq("token_issued_at", issuedAt).limit(1);
      return (must<unknown[] | null>(await q, "Reading the ledger") ?? []).length > 0;
    },
    async logMint(row) {
      must(await t("connector_mints").insert(row), "Logging");
    },
    async finishMint(id, patch) {
      must(await t("connector_mints").update(patch).eq("id", id), "Logging the answer");
    },
    async tokens(userId) {
      return must<TokenRow | null>(await t("connector_github_tokens").select(TOKENS).eq("user_id", userId).maybeSingle(), "Reading your GitHub sign-in");
    },
    async pendingDisconnects() {
      return must<TokenRow[] | null>(await t("connector_github_tokens").select(TOKENS).not("disconnect_pending_at", "is", null).limit(BATCH), "Reading pending disconnects") ?? [];
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
    async claimLive(workerId, subject, now, until) {
      const r = await t("connector_live_claims").insert({ worker_id: workerId, subject, until });
      if (!r.error) return true;
      if (r.error.code !== "23505") must(r, "Claiming the token");
      const q = t("connector_live_claims").update({ until }).eq("worker_id", workerId).eq("subject", subject).lt("until", now).select("subject");
      return (must<unknown[] | null>(await q, "Claiming the token") ?? []).length > 0;
    },
    async releaseLive(workerId, subject) {
      must(await t("connector_live_claims").delete().eq("worker_id", workerId).eq("subject", subject), "Releasing the token claim");
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
      return must<LiveToken[] | null>(await q.limit(BATCH), "Reading the live tokens") ?? [];
    },
    async dropLiveTokens(ids) {
      if (ids.length) must(await t("connector_live_tokens").delete().in("id", ids), "Dropping the tokens");
    },
  };
}
