// Shared fakes for the connector minter's tests (lib/connector-*.test.ts): an in-memory ConnectorDb with the same
// rules the Supabase queries keep (a nonce logs once per worker, the rate limits count by time, a refresh claim holds
// until its time, a signed grant lands only at its epoch), a fake GitHub that routes by method and URL, and a sealing
// key. The Mac keys and signed rows are lib/connector-trust.harness.ts's.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mintMessage, type MintRequest } from "./connector-grant";
import { sealToken, type ConnectorKey } from "./connector-crypto";
import type { AllowRow, ConnectorDb, GrantRow, LiveToken, MintLog, PinnedCard, StartRow, TokenRow, WorkerRow } from "./connector-db";
import type { SignerRow, WorkerPin } from "./connector-db-trust";
import { bound, type TokenDeps } from "./connector-tokens";
import type { AppConfig } from "./github-app";

export const NOW = Date.parse("2026-11-02T12:00:00.000Z");
export const KEY: ConnectorKey = { id: "v1", key: Buffer.alloc(32, 7) };
export const CFG: AppConfig = { clientId: "Iv1.abc", clientSecret: "shh" };
export const iso = (ms: number) => new Date(ms).toISOString();

// A clock that moves on by `step` ms every time it's read, as a real one does between a request's steps.
export function ticking(start = NOW, step = 1_000) {
  let t = start - step;
  const clock = () => (t += step);
  clock.set = (ms: number) => void (t = ms - step);
  return clock;
}

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
  allows: (AllowRow & { user_id: string })[];
  starts: StoredStart[];
  pinned: Map<string, PinnedCard>;
  cards: Map<string, { deleted: boolean; column: string | null; owner_worker?: string }>;
  mints: StoredMint[];
  tokens: Map<string, StoredTokens>;
  live: StoredLive[];
  signers: SignerRow[];
  pins: WorkerPin[];
  nonces: { user_id: string; nonce: string; at: string }[];
  emails: Map<string, string>;
  claims: Map<string, string>;
}

const done = <T>(v: T) => Promise.resolve(v);

function trustDb(state: FakeState, clock: () => number, nextId: () => number): Pick<ConnectorDb, "signerById" | "signerByKey" | "signers" | "saveSigner" | "setConfirm" | "trustSigner" | "dropPinsBySigner" | "revokeSigner" | "workerPin" | "savePin" | "takeNonce" | "dropNoncesBefore" | "writeGrant" | "saveAllow" | "userEmail"> {
  return {
    signerById: (id) => done(state.signers.find((s) => s.id === id) ?? null),
    signerByKey: (userId, key) => done(state.signers.find((s) => s.user_id === userId && s.sign_key === key) ?? null),
    signers: (userId) => done(state.signers.filter((s) => s.user_id === userId)),
    saveSigner: (row) => {
      state.signers = state.signers.filter((s) => !(s.user_id === row.user_id && s.sign_key === row.sign_key));
      const stored: SignerRow = { id: `s${nextId()}`, endorsed_by: null, ...row, device: row.device ?? null, added_at: iso(clock()), revoked_at: null };
      state.signers.push(stored);
      return done(stored);
    },
    setConfirm: (id, c) => {
      for (const s of state.signers) if (s.id === id) Object.assign(s, c);
      return done(undefined);
    },
    trustSigner: (id, at, by) => {
      for (const s of state.signers) if (s.id === id) Object.assign(s, { trusted_from: at, endorsed_by: by, confirm_hash: null, confirm_expires_at: null });
      return done(undefined);
    },
    dropPinsBySigner: (signerId) => {
      state.pins = state.pins.filter((p) => p.signer_id !== signerId);
      return done(undefined);
    },
    revokeSigner: (id, at) => {
      for (const s of state.signers) if (s.id === id) s.revoked_at = at;
      return done(undefined);
    },
    workerPin: (workerId) => done(state.pins.find((p) => p.worker_id === workerId) ?? null),
    savePin: (pin) => {
      state.pins = [...state.pins.filter((p) => p.worker_id !== pin.worker_id), pin];
      return done(undefined);
    },
    takeNonce: (userId, nonce) => {
      if (state.nonces.some((n) => n.user_id === userId && n.nonce === nonce)) return done(false);
      state.nonces.push({ user_id: userId, nonce, at: iso(clock()) });
      return done(true);
    },
    dropNoncesBefore: (at) => {
      state.nonces = state.nonces.filter((n) => n.at >= at);
      return done(undefined);
    },
    writeGrant: (row, prevEpoch) => {
      const at = state.grants.findIndex((g) => g.user_id === row.user_id && g.worker_id === row.worker_id && g.connector === row.connector);
      const was = state.grants[at] ?? null;
      if ((was?.epoch ?? 0) !== prevEpoch) return done(false);
      const expires = row.lifetime === "revoked" ? null : iso(clock() + (row.lifetime === "8h" ? 8 : 24) * 3_600_000);
      const next: GrantRow = { id: was?.id ?? `g${nextId()}`, last_used_at: was?.last_used_at ?? null, expires_at: was && was.lifetime === row.lifetime ? was.expires_at : expires, ...row };
      if (at < 0) state.grants.push(next);
      else state.grants[at] = next;
      return done(true);
    },
    saveAllow: (row) => {
      state.allows = [...state.allows.filter((a) => !(a.grant_id === row.grant_id && a.kind === row.kind && a.subject === row.subject)), row];
      return done(undefined);
    },
    userEmail: (userId) => done(state.emails.get(userId) ?? null),
  };
}

function mintDb(state: FakeState, clock: () => number, nextId: () => number): Pick<ConnectorDb, "admitMint" | "handedUser" | "logMint" | "finishMint"> {
  const counted = (m: StoredMint, since: number) => m.outcome !== "notice" && Date.parse(m.at) > since;
  return {
    admitMint: (row, l) => {
      if (row.nonce && state.mints.some((m) => m.worker_id === row.worker_id && m.nonce === row.nonce)) return done("replay" as const);
      const now = clock();
      const byWorker = (ms: number) => state.mints.filter((m) => m.worker_id === row.worker_id && counted(m, now - ms)).length;
      const byUser = (ms: number) => state.mints.filter((m) => m.user_id === row.user_id && counted(m, now - ms)).length;
      if (byWorker(60_000) >= l.workerMinute || byWorker(3_600_000) >= l.workerHour || byUser(60_000) >= l.userMinute || byUser(3_600_000) >= l.userHour) return done("limited" as const);
      const id = nextId();
      state.mints.push({ ...row, id, at: iso(now) });
      return done(id);
    },
    handedUser: (workerId, issuedAt) =>
      done(state.mints.some((m) => m.worker_id === workerId && m.outcome === "minted" && m.token_kind === "user" && m.token_issued_at && Date.parse(m.token_issued_at) === Date.parse(issuedAt))),
    logMint: (row) => {
      state.mints.push({ ...row, id: nextId(), at: iso(clock()) });
      return done(undefined);
    },
    finishMint: (id, patch) => {
      const m = state.mints.find((x) => x.id === id);
      if (m) Object.assign(m, patch);
      return done(undefined);
    },
  };
}

function tokenDb(state: FakeState, nextId: () => number): Pick<ConnectorDb, "tokens" | "pendingDisconnects" | "saveTokens" | "deleteTokens" | "claimRefresh" | "claimLive" | "releaseLive" | "liveToken" | "saveLiveToken" | "liveTokens" | "dropLiveTokens"> {
  const strip = (row: StoredTokens): TokenRow => {
    const copy: Partial<StoredTokens> = { ...row };
    delete copy.refreshing_until;
    return copy as TokenRow;
  };
  return {
    tokens: (userId) => {
      const row = state.tokens.get(userId);
      return done(row ? strip(row) : null);
    },
    pendingDisconnects: () => done([...state.tokens.values()].filter((r) => r.disconnect_pending_at).map(strip)),
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
    claimLive: (workerId, subject, now, until) => {
      const k = `${workerId}/${subject}`;
      const held = state.claims.get(k);
      if (held && held >= now) return done(false);
      state.claims.set(k, until);
      return done(true);
    },
    releaseLive: (workerId, subject) => {
      state.claims.delete(`${workerId}/${subject}`);
      return done(undefined);
    },
    liveToken: (workerId, subject) => done(state.live.find((l) => l.worker_id === workerId && l.subject === subject) ?? null),
    saveLiveToken: (row) => {
      const at = state.live.findIndex((l) => l.worker_id === row.worker_id && l.subject === row.subject);
      const stored: StoredLive = { id: `live-${nextId()}`, ...row };
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
}

export function fakeDb(clock: () => number = () => NOW): { db: ConnectorDb; state: FakeState } {
  const state: FakeState = { workers: [], grants: [], allows: [], starts: [], pinned: new Map(), cards: new Map(), mints: [], tokens: new Map(), live: [], signers: [], pins: [], nonces: [], emails: new Map(), claims: new Map() };
  const strip = (w: WorkerRow & { key_hash: string }): WorkerRow => ({ id: w.id, org_id: w.org_id, owner_user: w.owner_user, name: w.name, sign_key: w.sign_key, revoked_at: w.revoked_at });
  let n = 1;
  const nextId = () => n++;
  const db: ConnectorDb = {
    ...trustDb(state, clock, nextId),
    ...mintDb(state, clock, nextId),
    ...tokenDb(state, nextId),
    workerByKeyHash: (hash) => {
      const w = state.workers.find((x) => x.key_hash === hash);
      return done(w ? strip(w) : null);
    },
    workerById: (id) => {
      const w = state.workers.find((x) => x.id === id);
      return done(w ? strip(w) : null);
    },
    grant: (userId, workerId, connector) => done(state.grants.find((g) => g.user_id === userId && g.worker_id === workerId && g.connector === connector) ?? null),
    grantById: (id) => done(state.grants.find((g) => g.id === id) ?? null),
    expiredGrants: (now) => done(state.grants.filter((g) => g.expires_at && g.expires_at < now)),
    grantsBySigner: (signerId) => done(state.grants.filter((g) => g.signer_id === signerId)),
    touchGrant: (id, at) => {
      for (const g of state.grants) if (g.id === id) g.last_used_at = at;
      return done(undefined);
    },
    deleteGrants: (userId, connector, workerId) => {
      const gone = state.grants.filter((g) => g.user_id === userId && g.connector === connector && (!workerId || g.worker_id === workerId));
      state.grants = state.grants.filter((g) => !gone.includes(g));
      return done(gone.length);
    },
    allow: (grantId, kind, subject) => done(state.allows.find((a) => a.grant_id === grantId && a.kind === kind && a.subject === subject) ?? null),
    starts: (workerId, cardId, userId) =>
      done(state.starts.filter((s) => s.worker_id === workerId && s.card_id === cardId && s.created_by === userId && ["new_card", "run", "host"].includes(s.kind))),
    pinnedCard: (workerId, cardId) => done(state.pinned.get(`${workerId}/${cardId}`) ?? null),
    pinCard: (workerId, cardId, card) => {
      if (!state.pinned.has(`${workerId}/${cardId}`)) state.pinned.set(`${workerId}/${cardId}`, card);
      return done(undefined);
    },
    cardState: (orgId, workerId, cardId) => {
      const c = state.cards.get(`${orgId}/${cardId}`);
      return done(c && (c.owner_worker ?? workerId) === workerId ? { deleted: c.deleted, column: c.column } : null);
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
    disconnect_pending_at: null,
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
