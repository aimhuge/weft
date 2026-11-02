// weft.zip's connector minter (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built): a worker
// asks for a GitHub token for one of its cards; this decides from the database, never the worker's word, and answers
// a token with its handed-out expiry, or a refusal. Every answer goes in the ledger (connector_mints).
//
//   key + signature (lib/connector-auth.ts) ─ a trusted Mac vouched for this pairing (lib/connector-trust.ts)
//   ─ nonce once and the rate limits, in one DB step ─ the grant: on, inside its lifetime, signed by a trusted Mac
//   ─ you started the card from a trusted Mac, which signed its repo, fresh, once ─ the repo is the card's and the grant's ─ the card (this worker's) isn't
//   Done or deleted ─ the approval's signed Allow, when it asks one ─ a token (lib/connector-tokens.ts), logged
//   ─ the grant re-read: still there at the epoch checked, else no answer
import "server-only";
import { allowSubject, isLive, settingsOf } from "./connector-grant";
import type { ConnectorDb, GrantRow, MintLimits, MintLog, WorkerRow } from "./connector-db";
import { parseMint, signedWorker, type SignedMint } from "./connector-auth";
import { handedExpiry, MintError, narrowToken, userToken, type Handed, type TokenDeps } from "./connector-tokens";
import { allowProblem, grantProblem, pinProblem } from "./connector-trust";
import { cardProject, openCard } from "./connector-card";

// Per worker: enough for every card's git and gh to ask a few times a minute (the daemon caches tokens), not enough to
// hammer GitHub's refresh endpoint with a stolen key. Per user, across all their workers, a cap on top.
export const LIMITS: MintLimits = { workerMinute: 30, workerHour: 300, userMinute: 60, userHour: 600 };

export interface MintAnswer {
  status: number;
  body: Record<string, unknown>;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

async function checkGrant(db: ConnectorDb, worker: WorkerRow, req: SignedMint, now: number): Promise<GrantRow> {
  const grant = await db.grant(worker.owner_user, worker.id, req.connector);
  if (!grant) throw new MintError(403, `GitHub isn't turned on for ${worker.name}. Turn it on in Weft → Settings → Devices → ${worker.name} → Connectors.`);
  if (!isLive(grant.expires_at, now)) throw new MintError(403, `${worker.name}'s GitHub access ended (its lifetime ran out). Turn it on again in Settings → Devices.`);
  const problem = await grantProblem(db, grant, now);
  if (problem) throw new MintError(403, `${problem} Turn GitHub on for ${worker.name} again from a trusted Mac.`);
  return grant;
}

async function checkAllow(db: ConnectorDb, worker: WorkerRow, grant: GrantRow, allow: { kind: "project" | "card"; subject: string }, now: number) {
  const row = await db.allow(grant.id, allow.kind, allow.subject);
  if (!row || (await allowProblem(db, row, worker.owner_user, now))) {
    throw new MintError(403, `GitHub on ${worker.name} asks per ${allow.kind}: allow this ${allow.kind} in Weft → Settings → Devices → ${worker.name} → Connectors.`, "needs_allow");
  }
}

async function decide(deps: TokenDeps, worker: WorkerRow, req: SignedMint, grant: GrantRow, now: number): Promise<{ handed: Handed; kind: "user" | "scoped" }> {
  const { db } = deps;
  const project = await cardProject(db, worker, req.cardId, now);
  if (!same(project.repo, req.repo)) throw new MintError(403, `That card's project is ${project.repo}, not ${req.repo}.`);
  if (!grant.repos.includes(project.repo.toLowerCase())) throw new MintError(403, `GitHub on ${worker.name} doesn't cover ${project.repo}. Turn it on again from the Mac with that checkout to add it.`);
  await openCard(db, worker, req.cardId, now);
  const settings = settingsOf(grant);
  const allow = allowSubject(settings.approval, { id: req.cardId, repo: project.repo });
  if (allow) await checkAllow(db, worker, grant, allow, now);
  if (settings.scope === "installed") return { handed: await userToken(deps, worker.owner_user), kind: "user" };
  const subject = settings.scope === "project" ? `project:${project.repo.toLowerCase()}` : `card:${req.cardId}`;
  return { handed: await narrowToken(deps, { userId: worker.owner_user, workerId: worker.id, subject, repo: project.repo }), kind: "scoped" };
}

const refusal = (err: unknown): MintAnswer => {
  if (err instanceof MintError) return { status: err.status, body: { error: err.message, ...(err.outcome === "needs_allow" ? { needs: "allow" } : {}) } };
  return { status: 502, body: { error: `Couldn't mint: ${(err as Error).message}` } };
};

// The worker, checked: its key, its signature, and a trusted Mac's word for its pairing.
async function admitted(deps: TokenDeps, authorization: string | null, raw: unknown, now: number): Promise<{ req: SignedMint; worker: WorkerRow }> {
  const req = parseMint(raw);
  const worker = await signedWorker(deps.db, authorization, req, now);
  const pin = await pinProblem(deps.db, worker, now);
  if (pin) throw new MintError(403, pin);
  return { req, worker };
}

export async function mint(deps: TokenDeps, authorization: string | null, raw: unknown): Promise<MintAnswer> {
  const { db } = deps;
  const now = deps.now();
  let req: SignedMint;
  let worker: WorkerRow;
  let id: number | "replay" | "limited";
  try {
    ({ req, worker } = await admitted(deps, authorization, raw, now));
    const entry: MintLog = { user_id: worker.owner_user, worker_id: worker.id, grant_id: null, connector: req.connector, card_id: req.cardId, repo: req.repo, outcome: "refused", reason: "in progress", token_kind: null, nonce: req.nonce };
    id = await db.admitMint(entry, LIMITS);
  } catch (err) {
    return refusal(err);
  }
  if (id === "replay") return { status: 401, body: { error: "That request was answered already." } };
  if (id === "limited") return { status: 429, body: { error: "Too many token requests from this worker. Wait a minute." } };
  try {
    const grant = await checkGrant(db, worker, req, now);
    const { handed, kind } = await decide(deps, worker, req, grant, now);
    // Logged before the grant is read again, so a revoke that deletes the grant after this read finds it in the ledger.
    await db.finishMint(id, { grant_id: grant.id, outcome: "minted", reason: null, token_kind: kind, token_issued_at: kind === "user" ? new Date(handed.issuedAt).toISOString() : null });
    const still = await db.grant(worker.owner_user, worker.id, req.connector);
    if (!still || still.id !== grant.id || still.epoch !== grant.epoch || !isLive(still.expires_at, deps.now())) throw new MintError(409, `GitHub on ${worker.name} was turned off or changed while this was asked. Ask again.`);
    await db.touchGrant(grant.id, new Date(now).toISOString());
    return { status: 200, body: { token: handed.token, expiresAt: handedExpiry(handed.issuedAt), login: handed.login, kind, asks: settingsOf(grant).asks } };
  } catch (err) {
    const outcome = err instanceof MintError ? err.outcome : "refused";
    await db.finishMint(id, { outcome, reason: (err as Error).message.slice(0, 300) }).catch(() => undefined);
    return refusal(err);
  }
}
