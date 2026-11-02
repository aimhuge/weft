// The connector minter's daily sweep on weft.zip (app/api/cron/connectors, a Vercel cron; hourly needs a paid plan;
// docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built). The mint already refuses a grant past
// its lifetime; this ends what such a grant left behind, and retries what GitHub didn't confirm:
// - a grant past its lifetime: deleted, and its worker's tokens ended (lib/connector-revoke.ts revokeWorker);
// - a narrowed token no grant covers (a retired one, a revoked worker's, one whose delete GitHub didn't confirm):
//   deleted at GitHub, its row dropped on the 204 or once it's past its own life;
// - a disconnect GitHub didn't confirm: the authorization deleted again, the sign-in forgotten once it's gone;
// - the nonces of signed statements, after a day (a statement is only taken within minutes of its time).
import "server-only";
import { openToken } from "./connector-crypto";
import type { LiveToken } from "./connector-db";
import { bound, RETIRED, type TokenDeps } from "./connector-tokens";
import { endAuthorization, forgetGithub, revokeWorker } from "./connector-revoke";
import { deleteAppToken } from "./github-app";

// How long a narrowed token is assumed to live when GitHub gave no expiry: its parent's 8 hours.
export const ASSUMED_LIFE_MS = 8 * 3_600_000;
const DAY_MS = 24 * 3_600_000;

export interface SweepResult {
  expired: number;
  tokensRevoked: number;
  tokensDropped: number;
  disconnects: number;
  failed: string[];
}

// Whether a narrowed token is still covered by a live grant for its worker (so it's in use and stays).
async function covered(deps: TokenDeps, row: LiveToken): Promise<boolean> {
  if (row.subject.startsWith(RETIRED) || !row.user_id || !row.worker_id) return false;
  return Boolean(await deps.db.grant(row.user_id, row.worker_id, "github"));
}

const pastLife = (row: LiveToken, now: number) => (row.expires_at ? Date.parse(row.expires_at) : Date.parse(row.issued_at) + ASSUMED_LIFE_MS) <= now;

async function sweepLive(deps: TokenDeps, out: SweepResult) {
  const now = deps.now();
  const drop: string[] = [];
  for (const row of await deps.db.liveTokens({})) {
    if (await covered(deps, row)) continue;
    const token = openToken(row.token_sealed, bound.live(row.worker_id ?? "", row.subject), deps.key);
    if (token && (await deleteAppToken(deps.cfg, token, "token", deps.fetch))) out.tokensRevoked++;
    else if (token && !pastLife(row, now)) continue;
    drop.push(row.id);
  }
  out.tokensDropped += drop.length;
  await deps.db.dropLiveTokens(drop);
}

export async function sweep(deps: TokenDeps): Promise<SweepResult> {
  const out: SweepResult = { expired: 0, tokensRevoked: 0, tokensDropped: 0, disconnects: 0, failed: [] };
  const at = new Date(deps.now()).toISOString();
  const step = async (what: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      out.failed.push(`${what}: ${(err as Error).message}`);
    }
  };
  for (const g of await deps.db.expiredGrants(at)) {
    await step(`grant ${g.id}`, async () => {
      const r = await revokeWorker(deps, g.user_id, g.worker_id);
      out.expired++;
      out.tokensRevoked += r.tokensRevoked;
    });
  }
  await step("narrowed tokens", () => sweepLive(deps, out));
  for (const row of await deps.db.pendingDisconnects()) {
    await step(`disconnect ${row.user_id}`, async () => {
      if ((await endAuthorization(deps, row.user_id)) !== "deleted") return;
      await forgetGithub(deps, row.user_id);
      out.disconnects++;
    });
  }
  await step("nonces", () => deps.db.dropNoncesBefore(new Date(deps.now() - DAY_MS).toISOString()));
  return out;
}
