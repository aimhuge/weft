// weft.zip's connector minter (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built): a worker
// asks for a GitHub token for one of its cards; this decides from the database, never the worker's word, and answers
// a token with its handed-out expiry, or a refusal. Every answer goes in the ledger (connector_mints).
//
//   key + signature (lib/connector-auth.ts) ─ a trusted Mac vouched for this pairing (lib/connector-trust.ts)
//   ─ nonce once and the rate limits, in one DB step ─ the grant: on, inside its lifetime, signed by a trusted Mac
//   ─ you started the card from a trusted Mac, which signed its repo ─ the repo is the card's ─ the card (this worker's) isn't
//   Done or deleted ─ the approval's signed Allow, when it asks one ─ a token (lib/connector-tokens.ts), logged
//   ─ the grant re-read: still there at the epoch checked, else no answer
import "server-only";
import { allowSubject, isLive, settingsOf } from "./connector-grant";
import type { ConnectorDb, GrantRow, MintLimits, MintLog, PinnedCard, StartRow, WorkerRow } from "./connector-db";
import { parseMint, signedWorker, type SignedMint } from "./connector-auth";
import { handedExpiry, MintError, narrowToken, userToken, type Handed, type TokenDeps } from "./connector-tokens";
import { allowProblem, grantProblem, pinProblem, startProblem } from "./connector-trust";

// Per worker: enough for every card's git and gh to ask a few times a minute (the daemon caches tokens), not enough to
// hammer GitHub's refresh endpoint with a stolen key. Per user, across all their workers, a cap on top.
export const LIMITS: MintLimits = { workerMinute: 30, workerHour: 300, userMinute: 60, userHour: 600 };

export interface MintAnswer {
  status: number;
  body: Record<string, unknown>;
}

// The command that starts a card the connector serves: the desktop board's card.create, whose card id is in the args you
// wrote. A run or new_card gets its card id from the worker's report, so it can't carry a signed start; a reply or a verb
// over the H6 line makes no such row; and a card another worker sent (worker_new_card stamps it fromWorker) isn't yours.
const startsCard = (r: StartRow) => {
  const p = (r.payload ?? {}) as { verb?: unknown; fromWorker?: unknown };
  return !p.fromWorker && r.kind === "host" && p.verb === "card.create";
};

// The repo a start names: a run's git URL (https://github.com/<owner>/<name>.git) or the owner/name the desktop board
// put on a card.create from the project's own origin (lib/worker-folder-repo.ts). Null for anything else.
export function repoOfUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = /^(?:https:\/\/github\.com\/)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url);
  return m?.[1] ?? null;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// The card's project, pinned the first time a mint checks it (start commands expire after a day): the folder and repo
// of the one start command you created for it, signed by a Mac of yours trusted now (lib/worker-folder-repo.ts asks main
// to sign every desktop card.create). A session alone can queue a card.create naming any repo, but can't sign one, so an
// unsigned start never mints; nor does a card with several starts (which one would it be?).
async function cardProject(db: ConnectorDb, worker: WorkerRow, req: SignedMint, now: number): Promise<PinnedCard> {
  const pinned = await db.pinnedCard(worker.id, req.cardId);
  if (pinned) {
    if (pinned.user_id !== worker.owner_user) throw new MintError(403, "That card isn't one you started.");
    return pinned;
  }
  const rows = (await db.starts(worker.id, req.cardId, worker.owner_user)).filter((r) => r.created_by === worker.owner_user);
  if (rows.length > 1) throw new MintError(403, "That card has more than one start, so Weft can't tell which is yours. Start a new card for this project.");
  const start = rows.find(startsCard);
  if (!start) throw new MintError(403, "Connectors only work in a card you started on this worker from the board. Start a new card for this project.");
  const payload = start.payload as { repo?: unknown; start?: unknown };
  const repo = repoOfUrl(payload.repo);
  if (!repo) throw new MintError(403, "That card's start didn't name its GitHub repo. Start it from the desktop board, which reads the project's origin.");
  const problem = await startProblem(db, { userId: worker.owner_user, workerId: worker.id, cardId: req.cardId, folder: start.folder, repo, start: payload.start }, now);
  if (problem) throw new MintError(403, problem);
  const card = { user_id: worker.owner_user, folder: start.folder, repo };
  await db.pinCard(worker.id, req.cardId, card);
  return card;
}

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
  const project = await cardProject(db, worker, req, now);
  if (!same(project.repo, req.repo)) throw new MintError(403, `That card's project is ${project.repo}, not ${req.repo}.`);
  const state = await db.cardState(worker.org_id, worker.id, req.cardId);
  if (state?.deleted || state?.column === "done") throw new MintError(403, "That card is Done or deleted, so it gets no token.");
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
