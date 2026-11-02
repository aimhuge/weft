// Turning a worker's connector off, revoking the worker, or disconnecting GitHub altogether, on weft.zip
// (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built). The grant goes first, so minting stops at
// once; then every token the worker could hold is ended at GitHub, and the answer says what GitHub confirmed:
// - a narrowed token: DELETE /applications/{client_id}/token, confirmed only by its 204 (a 404 proves nothing), and
//   its row kept until then, for the daily sweep (lib/connector-sweep.ts) to retry;
// - the shared user token, when this worker was handed the current one (the ledger names which one each answer gave):
//   refreshed under the refresh claim, after any refresh in flight, which per GitHub's docs ends the old access token.
//   If the refresh fails, the old token is deleted the same way as a narrowed one.
// Disconnecting deletes the whole authorization (DELETE …/grant) with a token young enough for GitHub to know (it
// refreshes first past 7 hours), and forgets the refresh token only once GitHub confirmed; until then nothing mints.
import "server-only";
import { openToken } from "./connector-crypto";
import { bound, CLAIM_MS, MintError, pause, refreshNow, WAIT_STEPS, type TokenDeps } from "./connector-tokens";
import { deleteAppToken } from "./github-app";

export interface RevokeAnswer {
  grants: number;
  tokensRevoked: number;
  // Tokens GitHub didn't confirm, with when each ends by itself (GitHub's own expiry, at most 8 hours).
  unconfirmed: { expiresAt: string | null }[];
  userToken: "rotated" | "deleted" | "unconfirmed" | "not handed out";
}

// A user access token this old is refreshed before it's used to delete the authorization: GitHub's own life is 8 hours.
export const YOUNG_MS = 7 * 3_600_000;

// Every narrowed token the worker holds, retired ones too. Only the ones GitHub confirmed (or that can't be opened, so
// nothing can ever be done with them, which still count as unconfirmed) leave the table; the rest stay for the sweep.
export async function endLiveTokens(deps: TokenDeps, workerId: string) {
  const live = await deps.db.liveTokens({ workerId });
  let revoked = 0;
  const unconfirmed: { expiresAt: string | null }[] = [];
  const gone: string[] = [];
  for (const row of live) {
    const token = openToken(row.token_sealed, bound.live(workerId, row.subject), deps.key);
    if (!token) {
      // Sealed under a key or binding this server can't open: nothing can delete it, so it's reported and dropped.
      gone.push(row.id);
      unconfirmed.push({ expiresAt: row.expires_at });
    } else if (await deleteAppToken(deps.cfg, token, "token", deps.fetch)) {
      revoked++;
      gone.push(row.id);
    } else unconfirmed.push({ expiresAt: row.expires_at });
  }
  await deps.db.dropLiveTokens(gone);
  return { revoked, unconfirmed };
}

// Ends the shared user token while this worker holds the current one. Each pass reads the current token: one the
// worker was never handed is done; else it claims the refresh (or waits out the one in flight) and spends it.
export async function endUserToken(deps: TokenDeps, userId: string, workerId: string): Promise<RevokeAnswer["userToken"]> {
  let held = false;
  for (let step = 0; step <= WAIT_STEPS; step++) {
    const row = await deps.db.tokens(userId);
    if (!row?.access_issued_at || !(await deps.db.handedUser(workerId, row.access_issued_at))) return held ? "rotated" : "not handed out";
    held = true;
    const now = deps.now();
    if (await deps.db.claimRefresh(userId, new Date(now).toISOString(), new Date(now + CLAIM_MS).toISOString())) {
      // Read again under the claim: one that finished since the read above already ended this token.
      const fresh = await deps.db.tokens(userId);
      if (!fresh || fresh.access_issued_at !== row.access_issued_at) {
        await deps.db.saveTokens({ user_id: userId, refreshing_until: null });
        continue;
      }
      try {
        await refreshNow(deps, userId, fresh.refresh_sealed, fresh.github_login);
        continue;
      } catch {
        const old = openToken(row.access_sealed, bound.access(userId), deps.key);
        return old && (await deleteAppToken(deps.cfg, old, "token", deps.fetch)) ? "deleted" : "unconfirmed";
      }
    }
    await pause(deps);
  }
  return "unconfirmed";
}

// Ends every token the worker could hold, without touching its grant: for a revoke, and for a grant made stricter.
export async function endWorkerTokens(deps: TokenDeps, userId: string, workerId: string) {
  const live = await endLiveTokens(deps, workerId);
  const userToken = await endUserToken(deps, userId, workerId);
  return { live, userToken, tokensRevoked: live.revoked + (userToken === "rotated" || userToken === "deleted" ? 1 : 0) };
}

export async function revokeWorker(deps: TokenDeps, userId: string, workerId: string): Promise<RevokeAnswer> {
  const worker = await deps.db.workerById(workerId);
  if (!worker || worker.owner_user !== userId) throw new MintError(404, "That isn't a worker of yours.");
  const grants = await deps.db.deleteGrants(userId, "github", workerId);
  const ended = await endWorkerTokens(deps, userId, workerId);
  const reason = `${ended.live.revoked} narrowed revoked, ${ended.live.unconfirmed.length} unconfirmed; user token ${ended.userToken}`;
  await deps.db.logMint({ user_id: userId, worker_id: workerId, grant_id: null, connector: "github", card_id: null, repo: null, outcome: "revoked", reason, token_kind: null, nonce: null });
  return { grants, tokensRevoked: ended.tokensRevoked, unconfirmed: ended.live.unconfirmed, userToken: ended.userToken };
}

// Deletes the whole authorization at GitHub with a token GitHub still knows: the stored one while it's young, else a
// fresh one, refreshed under the claim. "deleted" only on GitHub's 204.
export async function endAuthorization(deps: TokenDeps, userId: string): Promise<"deleted" | "unconfirmed"> {
  for (let step = 0; step <= WAIT_STEPS; step++) {
    const row = await deps.db.tokens(userId);
    if (!row) return "deleted";
    const access = openToken(row.access_sealed, bound.access(userId), deps.key);
    const issued = row.access_issued_at ? Date.parse(row.access_issued_at) : 0;
    const now = deps.now();
    if (access && now - issued < YOUNG_MS) return (await deleteAppToken(deps.cfg, access, "grant", deps.fetch)) ? "deleted" : "unconfirmed";
    if (await deps.db.claimRefresh(userId, new Date(now).toISOString(), new Date(now + CLAIM_MS).toISOString())) {
      try {
        const fresh = await refreshNow(deps, userId, row.refresh_sealed, row.github_login);
        return (await deleteAppToken(deps.cfg, fresh.token, "grant", deps.fetch)) ? "deleted" : "unconfirmed";
      } catch {
        return "unconfirmed";
      }
    }
    await pause(deps);
  }
  return "unconfirmed";
}

// Forgets the user's GitHub once the authorization is confirmed gone: the stored pair and every narrowed token row.
export async function forgetGithub(deps: TokenDeps, userId: string) {
  await deps.db.dropLiveTokens((await deps.db.liveTokens({ userId })).map((r) => r.id));
  await deps.db.deleteTokens(userId);
}

// Disconnect GitHub: every grant, then the whole authorization at GitHub. The stored refresh token and the narrowed
// tokens' rows stay, marked pending (so nothing mints), until GitHub confirms; the sweep retries.
export async function disconnect(deps: TokenDeps, userId: string): Promise<{ grants: number; authorization: "deleted" | "unconfirmed" | "none" }> {
  const grants = await deps.db.deleteGrants(userId, "github");
  if (!(await deps.db.tokens(userId))) return { grants, authorization: "none" };
  await deps.db.saveTokens({ user_id: userId, disconnect_pending_at: new Date(deps.now()).toISOString() });
  const authorization = await endAuthorization(deps, userId);
  if (authorization === "deleted") await forgetGithub(deps, userId);
  return { grants, authorization };
}
