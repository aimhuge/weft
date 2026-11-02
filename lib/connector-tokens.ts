// The GitHub tokens weft.zip hands to workers (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built).
// One chain per user: your refresh token, sealed in connector_github_tokens, and the current user access token beside
// it. A token is handed out until ROTATE_MS after it was issued, less HOLD_MARGIN_MS; the next ask after that
// refreshes, which per GitHub's docs ends the old access token and the old refresh token at once. So rotating is also
// how a token a worker held is revoked (lib/connector-revoke.ts), with nothing but GitHub's documented refresh.
// A narrowed scope gets a scoped user token per project or card (still you), kept in connector_live_tokens so a revoke
// can delete it at GitHub.
import "server-only";
import { reusable, ROTATE_MS } from "./connector-grant";
import { openToken, sealToken, type ConnectorKey } from "./connector-crypto";
import { randomUUID } from "node:crypto";
import type { ConnectorDb, LiveToken } from "./connector-db";
import { deleteAppToken, refreshTokens, scopedToken, type AppConfig, type Fetch } from "./github-app";

export interface TokenDeps {
  db: ConnectorDb;
  cfg: AppConfig;
  key: ConnectorKey;
  fetch: Fetch;
  now: () => number;
  sleep?: (ms: number) => Promise<void>;
  // Tells you about a new grant, worker or Mac key (lib/connector-notify.ts): an email where weft.zip can send one.
  notify?: (userId: string, subject: string, text: string) => Promise<void>;
  // weft.zip's own origin, for the links in an email (lib/connector-remote.ts connectorSite by default).
  site?: string;
}

export interface Handed {
  token: string;
  issuedAt: number;
  login: string;
}

// A refusal the routes turn into a status and a plain message.
export class MintError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly outcome: "refused" | "needs_allow" = "refused",
  ) {
    super(message);
  }
}

export const CLAIM_MS = 30_000;
export const WAIT_STEPS = 10;
export const pause = (deps: TokenDeps) => (deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(500);

export const bound = { refresh: (user: string) => `refresh:${user}`, access: (user: string) => `access:${user}`, live: (worker: string, subject: string) => `live:${worker}:${subject}` };

// The user's current access token, refreshed first when it's too old to hand out.
export async function userToken(deps: TokenDeps, userId: string): Promise<Handed> {
  for (let step = 0; step <= WAIT_STEPS; step++) {
    const row = await deps.db.tokens(userId);
    if (!row) throw new MintError(403, "GitHub isn't connected. Connect it in Weft → Settings → Devices.");
    if (row.disconnect_pending_at) throw new MintError(403, "GitHub is being disconnected. Connect it again in Weft → Settings → Devices.");
    const issued = row.access_issued_at ? Date.parse(row.access_issued_at) : 0;
    const access = openToken(row.access_sealed, bound.access(userId), deps.key);
    if (access && reusable(issued, deps.now())) return { token: access, issuedAt: issued, login: row.github_login };
    const now = deps.now();
    if (await deps.db.claimRefresh(userId, new Date(now).toISOString(), new Date(now + CLAIM_MS).toISOString())) {
      // Read again under the claim: a refresh that finished between the read above and the claim left a new pair, and
      // spending the old refresh token now would fail (and lose the new one).
      const fresh = await deps.db.tokens(userId);
      if (fresh && fresh.access_issued_at === row.access_issued_at) return refreshNow(deps, userId, fresh.refresh_sealed, fresh.github_login);
      await deps.db.saveTokens({ user_id: userId, refreshing_until: null });
      continue;
    }
    // Another mint is refreshing: its new token is what this one hands out too.
    await pause(deps);
  }
  throw new MintError(503, "GitHub's token is being refreshed. Try again in a moment.");
}

// Spends the refresh token (GitHub ends the old access token as it answers) and stores the new pair.
export async function refreshNow(deps: TokenDeps, userId: string, refreshSealed: string, login: string): Promise<Handed> {
  const refresh = openToken(refreshSealed, bound.refresh(userId), deps.key);
  const release = () => deps.db.saveTokens({ user_id: userId, refreshing_until: null });
  if (!refresh) {
    await release();
    throw new MintError(403, "Your GitHub sign-in on weft.zip can't be opened. Connect GitHub again in Weft → Settings → Devices.");
  }
  let set;
  try {
    set = await refreshTokens(deps.cfg, refresh, deps.fetch, deps.now());
  } catch (err) {
    await release();
    throw new MintError(502, `${(err as Error).message}. Connect GitHub again in Weft → Settings → Devices.`);
  }
  const issuedAt = deps.now();
  await deps.db.saveTokens({
    user_id: userId,
    refresh_sealed: sealToken(set.refresh, bound.refresh(userId), deps.key),
    refresh_expires_at: set.refreshExpiresAt,
    access_sealed: sealToken(set.access, bound.access(userId), deps.key),
    access_issued_at: new Date(issuedAt).toISOString(),
    access_expires_at: set.accessExpiresAt,
    refreshing_until: null,
  });
  return { token: set.access, issuedAt, login };
}

// A token narrowed to one repo for a project or a card (subject), reused while it may be handed out and while the user
// token it was made from is still the current one: whether refreshing a parent ends its scoped tokens isn't in GitHub's
// docs, so one made before the last refresh is never handed out again. Its predecessor is deleted at GitHub when it's
// replaced.
export async function narrowToken(deps: TokenDeps, o: { userId: string; workerId: string; subject: string; repo: string }): Promise<Handed> {
  for (let step = 0; step <= WAIT_STEPS; step++) {
    const [live, chain] = await Promise.all([deps.db.liveToken(o.workerId, o.subject), deps.db.tokens(o.userId)]);
    if (!chain) throw new MintError(403, "GitHub isn't connected. Connect it in Weft → Settings → Devices.");
    const kept = live ? openToken(live.token_sealed, bound.live(o.workerId, o.subject), deps.key) : null;
    const parentIssued = chain.access_issued_at ? Date.parse(chain.access_issued_at) : Number.POSITIVE_INFINITY;
    if (live && kept && live.repo === o.repo && Date.parse(live.issued_at) >= parentIssued && reusable(Date.parse(live.issued_at), deps.now())) {
      return { token: kept, issuedAt: Date.parse(live.issued_at), login: chain.github_login };
    }
    // One mint at a time makes a token for this (worker, subject): two at once would each overwrite the other's row
    // and leave a working token nothing tracks. The other's token is what this one hands out, once it's saved.
    const now = deps.now();
    if (await deps.db.claimLive(o.workerId, o.subject, new Date(now).toISOString(), new Date(now + CLAIM_MS).toISOString())) {
      try {
        return await makeNarrow(deps, o, live && kept ? { live, token: kept } : null);
      } finally {
        await deps.db.releaseLive(o.workerId, o.subject);
      }
    }
    await pause(deps);
  }
  throw new MintError(503, "A token for that repo is being made. Try again in a moment.");
}

async function makeNarrow(deps: TokenDeps, o: { userId: string; workerId: string; subject: string; repo: string }, old: { live: LiveToken; token: string } | null): Promise<Handed> {
  const parent = await userToken(deps, o.userId);
  let narrowed;
  try {
    narrowed = await scopedToken(deps.cfg, parent.token, o.repo, deps.fetch);
  } catch (err) {
    throw new MintError(502, (err as Error).message);
  }
  // The one it replaces ends first: deleted at GitHub, or kept as retired for the sweep to delete when GitHub didn't
  // confirm, so overwriting its row never loses track of a token that may still work.
  if (old) await retire(deps, { userId: o.userId, workerId: o.workerId, ...old });
  const issuedAt = deps.now();
  await deps.db.saveLiveToken({ user_id: o.userId, worker_id: o.workerId, subject: o.subject, repo: o.repo, token_sealed: sealToken(narrowed.token, bound.live(o.workerId, o.subject), deps.key), issued_at: new Date(issuedAt).toISOString(), expires_at: narrowed.expiresAt });
  return { token: narrowed.token, issuedAt, login: parent.login };
}

export const RETIRED = "retired:";

// A narrowed token taken out of use: deleted at GitHub (confirmed by its 204), or else moved to a retired row.
export async function retire(deps: TokenDeps, o: { userId: string; workerId: string; live: LiveToken; token: string }): Promise<boolean> {
  if (await deleteAppToken(deps.cfg, o.token, "token", deps.fetch)) return true;
  const subject = `${RETIRED}${randomUUID()}`;
  await deps.db.saveLiveToken({ user_id: o.userId, worker_id: o.workerId, subject, repo: o.live.repo, token_sealed: sealToken(o.token, bound.live(o.workerId, subject), deps.key), issued_at: o.live.issued_at, expires_at: o.live.expires_at });
  return false;
}

export const handedExpiry = (issuedAt: number) => new Date(issuedAt + ROTATE_MS).toISOString();
