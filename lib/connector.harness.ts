// Shared fakes for the connector minter's tests (lib/connector-*.test.ts): an in-memory ConnectorDb with the same
// rules the Supabase queries keep (a nonce logs once per worker, a refresh claim holds until its time, counts by time),
// a fake GitHub that routes by method and URL, and a sealing key.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mintMessage, type MintRequest } from "./connector-grant";
import { sealToken, type ConnectorKey } from "./connector-crypto";
import type { ConnectorDb, GrantRow, LiveToken, MintLog, PinnedCard, StartRow, TokenRow, WorkerRow } from "./connector-db";
import { bound, type TokenDeps } from "./connector-tokens";
import type { AppConfig } from "./github-app";

export const NOW = Date.parse("2026-11-02T12:00:00.000Z");
export const KEY: ConnectorKey = { id: "v1", key: Buffer.alloc(32, 7) };
export const CFG: AppConfig = { clientId: "Iv1.abc", clientSecret: "shh" };
export const iso = (ms: number) => new Date(ms).toISOString();

export interface StoredStart extends StartRow {
  worker_id: string;
  card_id: string;
}
export interface StoredMint extends MintLog {
  id: number;
  at: string;
}
export interface StoredLive extends LiveToken {
  user_id: string;
  worker_id: string;
}
export type StoredTokens = TokenRow & { refreshing_until: string | null };

export interface FakeState {
  workers: (WorkerRow & { key_hash: string })[];
  grants: GrantRow[];
  allows: { grant_id: string; kind: string; subject: string }[];
  starts: StoredStart[];
  pinned: Map<string, PinnedCard>;
  cards: Map<string, { deleted: boolean; column: string | null }>;
  mints: StoredMint[];
  tokens: Map<string, StoredTokens>;
  live: StoredLive[];
}

export function fakeDb(clock: () => number = () => NOW): { db: ConnectorDb; state: FakeState } {
  const state: FakeState = { workers: [], grants: [], allows: [], starts: [], pinned: new Map(), cards: new Map(), mints: [], tokens: new Map(), live: [] };
  const strip = (w: WorkerRow & { key_hash: string }): WorkerRow => ({ id: w.id, org_id: w.org_id, owner_user: w.owner_user, name: w.name, sign_key: w.sign_key, revoked_at: w.revoked_at });
  const done = <T>(v: T) => Promise.resolve(v);
  let nextId = 1;
  const db: ConnectorDb = {
    workerByKeyHash: (hash) => {
      const w = state.workers.find((x) => x.key_hash === hash);
      return done(w ? strip(w) : null);
    },
    workerById: (id) => {
      const w = state.workers.find((x) => x.id === id);
      return done(w ? strip(w) : null);
    },
    grant: (userId, workerId, connector) => done(state.grants.find((g) => g.user_id === userId && g.worker_id === workerId && g.connector === connector) ?? null),
    touchGrant: (id, at) => {
      for (const g of state.grants) if (g.id === id) g.last_used_at = at;
      return done(undefined);
    },
    deleteGrants: (userId, connector, workerId) => {
      const gone = state.grants.filter((g) => g.user_id === userId && g.connector === connector && (!workerId || g.worker_id === workerId));
      state.grants = state.grants.filter((g) => !gone.includes(g));
      return done(gone.length);
    },
    hasAllow: (grantId, kind, subject) => done(state.allows.some((a) => a.grant_id === grantId && a.kind === kind && a.subject === subject)),
    starts: (workerId, cardId, userId) =>
      done(state.starts.filter((s) => s.worker_id === workerId && s.card_id === cardId && s.created_by === userId && ["new_card", "run", "host"].includes(s.kind))),
    pinnedCard: (workerId, cardId) => done(state.pinned.get(`${workerId}/${cardId}`) ?? null),
    pinCard: (workerId, cardId, card) => {
      if (!state.pinned.has(`${workerId}/${cardId}`)) state.pinned.set(`${workerId}/${cardId}`, card);
      return done(undefined);
    },
    cardState: (orgId, cardId) => done(state.cards.get(`${orgId}/${cardId}`) ?? null),
    mintsSince: (workerId, since, kind) =>
      done(state.mints.filter((m) => m.worker_id === workerId && m.at >= since && (!kind || (m.token_kind === kind && m.outcome === "minted"))).length),
    logMint: (row) => {
      if (row.nonce && state.mints.some((m) => m.worker_id === row.worker_id && m.nonce === row.nonce)) return done("replay" as const);
      const id = nextId++;
      state.mints.push({ ...row, id, at: iso(clock()) });
      return done(id);
    },
    finishMint: (id, patch) => {
      const m = state.mints.find((x) => x.id === id);
      if (m) Object.assign(m, patch);
      return done(undefined);
    },
    tokens: (userId) => {
      const row = state.tokens.get(userId);
      if (!row) return done(null);
      const copy: Partial<StoredTokens> = { ...row };
      delete copy.refreshing_until;
      return done(copy as TokenRow);
    },
    saveTokens: (row) => {
      const was = state.tokens.get(row.user_id);
      state.tokens.set(row.user_id, { refreshing_until: null, ...was, ...row } as StoredTokens);
      return done(undefined);
    },
    deleteTokens: (userId) => {
      state.tokens.delete(userId);
      return done(undefined);
    },
    claimRefresh: (userId, now, until) => {
      const row = state.tokens.get(userId);
      if (!row || (row.refreshing_until && row.refreshing_until >= now)) return done(false);
      row.refreshing_until = until;
      return done(true);
    },
    liveToken: (workerId, subject) => done(state.live.find((l) => l.worker_id === workerId && l.subject === subject) ?? null),
    saveLiveToken: (row) => {
      const at = state.live.findIndex((l) => l.worker_id === row.worker_id && l.subject === row.subject);
      const stored: StoredLive = { id: `live-${nextId++}`, ...row };
      if (at >= 0) state.live[at] = stored;
      else state.live.push(stored);
      return done(undefined);
    },
    liveTokens: ({ workerId, userId }) => done(state.live.filter((l) => (!workerId || l.worker_id === workerId) && (!userId || l.user_id === userId))),
    dropLiveTokens: (ids) => {
      state.live = state.live.filter((l) => !ids.includes(l.id));
      return done(undefined);
    },
  };
  return { db, state };
}

// A fake GitHub: answers by "METHOD path" (path without the host), records every call with its parsed body.
export type Route = (body: unknown, init: RequestInit) => Response | Promise<Response>;
export interface FakeCall {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
export const noContent = () => new Response(null, { status: 204 });

export function fakeGithub(routes: Record<string, Route>) {
  const calls: FakeCall[] = [];
  const fetcher = (input: string | URL, init: RequestInit = {}): Promise<Response> => {
    const url = input.toString();
    const method = init.method ?? "GET";
    const raw = typeof init.body === "string" ? init.body : null;
    let body: unknown = raw;
    if (raw?.startsWith("{")) body = JSON.parse(raw);
    else if (raw !== null) body = Object.fromEntries(new URLSearchParams(raw));
    calls.push({ method, url, body, headers: { ...(init.headers as Record<string, string> | undefined) } });
    const path = url.replace(/^https:\/\/[^/]+/, "");
    const route = routes[`${method} ${path}`];
    if (!route) return Promise.resolve(json({ message: "Not Found" }, 404));
    return Promise.resolve(route(body, init));
  };
  return { fetch: fetcher as typeof fetch, calls, called: (method: string, path: string) => calls.filter((c) => c.method === method && c.url.endsWith(path)) };
}

// A token pair GitHub would send back on a refresh or a code exchange.
export const pair = (access: string, refresh: string) => json({ access_token: access, refresh_token: refresh, expires_in: 28_800, refresh_token_expires_in: 15_897_600 });

export function deps(db: ConnectorDb, fetcher: typeof fetch, clock: () => number = () => NOW): TokenDeps {
  return { db, cfg: CFG, key: KEY, fetch: fetcher, now: clock, sleep: () => Promise.resolve() };
}

// A user's chain, stored sealed: access issued at `issuedAt` (null for none).
export function storeTokens(state: FakeState, userId: string, o: { access?: string | null; refresh?: string; issuedAt?: number | null; login?: string } = {}) {
  const access = o.access === undefined ? "ghu_old" : o.access;
  const issuedAt = o.issuedAt === undefined ? NOW - 60_000 : o.issuedAt;
  state.tokens.set(userId, {
    user_id: userId,
    github_id: 42,
    github_login: o.login ?? "octo",
    refresh_sealed: sealToken(o.refresh ?? "ghr_old", bound.refresh(userId), KEY),
    refresh_expires_at: iso(NOW + 1e10),
    access_sealed: access === null ? null : sealToken(access, bound.access(userId), KEY),
    access_issued_at: issuedAt === null ? null : iso(issuedAt),
    access_expires_at: issuedAt === null ? null : iso(issuedAt + 8 * 3_600_000),
    refreshing_until: null,
  });
}

// A paired worker: its wwk_ key, the Ed25519 key it signs with, and a signer for mint bodies.
export function pairedWorker(state: FakeState, o: Partial<WorkerRow> = {}) {
  const key = `wwk_${(o.id ?? "w1").padEnd(64, "0").replace(/[^0-9a-f]/g, "a").slice(0, 64)}`;
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const signKey = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const worker: WorkerRow = { id: "w1", org_id: "org1", owner_user: "u1", name: "Mini", sign_key: signKey, revoked_at: null, ...o };
  state.workers.push({ ...worker, key_hash: createHash("sha256").update(key).digest("hex") });
  const signed = (body: Omit<MintRequest, "workerId">, workerId = worker.id) => ({ ...body, sig: sign(null, Buffer.from(mintMessage({ ...body, workerId })), privateKey).toString("base64") });
  return { worker, key, auth: `Bearer ${key}`, signed };
}

export function grantRow(o: Partial<GrantRow> = {}): GrantRow {
  return { id: "g1", user_id: "u1", worker_id: "w1", connector: "github", scope: "installed", approval: "worker", lifetime: "revoked", asks: ["protected_push"], expires_at: null, last_used_at: null, ...o };
}
