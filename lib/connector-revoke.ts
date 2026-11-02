// Turning a worker's connector off, revoking the worker, or disconnecting GitHub altogether, on weft.zip
// (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built). The grant goes first, so minting stops at
// once; then every token the worker could hold is ended at GitHub, and the answer says what GitHub confirmed:
// - a narrowed token: DELETE /applications/{client_id}/token, confirmed by its 204;
// - the shared user token, when this worker was handed it: refreshed, which per GitHub's docs ends the old access token
//   (the new one never leaves weft.zip until a worker with a live grant asks). If the refresh fails, the old token is
//   deleted the same way as a narrowed one.
// Disconnecting deletes the whole authorization (DELETE …/grant), which ends every token, and forgets the refresh token.
import "server-only";
import { openToken } from "./connector-crypto";
import { bound, MintError, refreshNow, type TokenDeps } from "./connector-tokens";
import { deleteAppToken } from "./github-app";

export interface RevokeAnswer {
  grants: number;
  tokensRevoked: number;
  // Tokens GitHub didn't confirm, with when each ends by itself (GitHub's own expiry, at most 8 hours).
  unconfirmed: { expiresAt: string | null }[];
  userToken: "rotated" | "deleted" | "unconfirmed" | "not handed out";
}

async function endLiveTokens(deps: TokenDeps, workerId: string) {
  const live = await deps.db.liveTokens({ workerId });
  let revoked = 0;
  const unconfirmed: { expiresAt: string | null }[] = [];
  for (const row of live) {
    const token = openToken(row.token_sealed, bound.live(workerId, row.subject), deps.key);
    if (token && (await deleteAppToken(deps.cfg, token, "token", deps.fetch))) revoked++;
    else unconfirmed.push({ expiresAt: row.expires_at });
  }
  await deps.db.dropLiveTokens(live.map((r) => r.id));
  return { revoked, unconfirmed };
}

// Ends the shared user token if this worker was handed the current one.
async function endUserToken(deps: TokenDeps, userId: string, workerId: string): Promise<RevokeAnswer["userToken"]> {
  const row = await deps.db.tokens(userId);
  if (!row?.access_issued_at) return "not handed out";
  if (!(await deps.db.mintsSince(workerId, row.access_issued_at, "user"))) return "not handed out";
  try {
    await refreshNow(deps, userId, row.refresh_sealed, row.github_login);
    return "rotated";
  } catch {
    const old = openToken(row.access_sealed, bound.access(userId), deps.key);
    return old && (await deleteAppToken(deps.cfg, old, "token", deps.fetch)) ? "deleted" : "unconfirmed";
  }
}

export async function revokeWorker(deps: TokenDeps, userId: string, workerId: string): Promise<RevokeAnswer> {
  const worker = await deps.db.workerById(workerId);
  if (!worker || worker.owner_user !== userId) throw new MintError(404, "That isn't a worker of yours.");
  const grants = await deps.db.deleteGrants(userId, "github", workerId);
  const live = await endLiveTokens(deps, workerId);
  const userToken = await endUserToken(deps, userId, workerId);
  await deps.db.logMint({ user_id: userId, worker_id: workerId, grant_id: null, connector: "github", card_id: null, repo: null, outcome: "revoked", reason: `${live.revoked} narrowed revoked; user token ${userToken}`, token_kind: null, nonce: null });
  return { grants, tokensRevoked: live.revoked + (userToken === "rotated" || userToken === "deleted" ? 1 : 0), unconfirmed: live.unconfirmed, userToken };
}

// Disconnect GitHub: every grant, every narrowed token, the whole authorization at GitHub, and the stored refresh token.
export async function disconnect(deps: TokenDeps, userId: string): Promise<{ grants: number; authorization: "deleted" | "unconfirmed" | "none" }> {
  const grants = await deps.db.deleteGrants(userId, "github");
  const row = await deps.db.tokens(userId);
  // Narrowed tokens are sealed per worker; the authorization's delete ends them all at GitHub anyway.
  await deps.db.dropLiveTokens((await deps.db.liveTokens({ userId })).map((r) => r.id));
  if (!row) return { grants, authorization: "none" };
  const access = openToken(row.access_sealed, bound.access(userId), deps.key);
  let authorization: "deleted" | "unconfirmed" = "unconfirmed";
  if (access) authorization = (await deleteAppToken(deps.cfg, access, "grant", deps.fetch)) ? "deleted" : "unconfirmed";
  else {
    try {
      const fresh = await refreshNow(deps, userId, row.refresh_sealed, row.github_login);
      if (await deleteAppToken(deps.cfg, fresh.token, "grant", deps.fetch)) authorization = "deleted";
    } catch {
      authorization = "unconfirmed";
    }
  }
  await deps.db.deleteTokens(userId);
  return { grants, authorization };
}
