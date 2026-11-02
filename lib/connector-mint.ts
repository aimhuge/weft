// weft.zip's connector minter (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built): a worker
// asks for a GitHub token for one of its cards; this decides from the database, never the worker's word, and answers
// a token with its handed-out expiry, or a refusal. Every answer goes in the ledger (connector_mints).
//
//   key + signature (lib/connector-auth.ts) ─ rate limit ─ nonce once ─ the grant: on, inside its lifetime
//   ─ you started the card (an owner-created start command, pinned the first time) ─ the repo is the card's project
//   ─ the card isn't Done or deleted ─ the approval's Allow, when it asks one ─ a token (lib/connector-tokens.ts)
import "server-only";
import { allowSubject, isLive, settingsOf } from "./connector-grant";
import type { ConnectorDb, GrantRow, MintLog, PinnedCard, StartRow, WorkerRow } from "./connector-db";
import { parseMint, signedWorker, type SignedMint } from "./connector-auth";
import { handedExpiry, MintError, narrowToken, userToken, type Handed, type TokenDeps } from "./connector-tokens";

// Per worker: enough for every card's git and gh to ask a few times a minute (the daemon caches tokens), not enough to
// hammer GitHub's refresh endpoint with a stolen key.
export const PER_MINUTE = 30;
export const PER_HOUR = 300;

export interface MintAnswer {
  status: number;
  body: Record<string, unknown>;
}

// The commands that start a card on a worker: a run, the web's new_card, the board's card.create verb. A reply or a
// verb sent over the H6 line makes no such row, so it can't stand in for one.
const startsCard = (r: StartRow) => r.kind !== "host" || (r.payload as { verb?: unknown } | null)?.verb === "card.create";

// The repo a run's git URL names (https://github.com/<owner>/<name>.git), or null.
export function repoOfUrl(url: unknown): string | null {
  const m = typeof url === "string" ? /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url) : null;
  return m?.[1] ?? null;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// The card's project, pinned the first time a mint checks it (start commands expire after a day): the folder and repo
// its owner-created start named. A start that named no repo URL pins the asked repo when its name is the folder's
// (a worker's folder is the repo's name, lib/worker-commands.ts).
async function cardProject(db: ConnectorDb, worker: WorkerRow, req: SignedMint): Promise<PinnedCard> {
  const pinned = await db.pinnedCard(worker.id, req.cardId);
  if (pinned) {
    if (pinned.user_id !== worker.owner_user) throw new MintError(403, "That card isn't one you started.");
    return pinned;
  }
  const started = (await db.starts(worker.id, req.cardId, worker.owner_user)).filter((r) => r.created_by === worker.owner_user && startsCard(r));
  const start = started[0];
  if (!start) throw new MintError(403, "Connectors only work in a card you started on this worker (from the board or weft.zip). Start a new card for this project.");
  const repo = repoOfUrl((start.payload as { repo?: unknown } | null)?.repo) ?? (same(req.repo.slice(req.repo.indexOf("/") + 1), start.folder) ? req.repo : null);
  if (!repo) throw new MintError(403, `That card was started in ${start.folder}, not ${req.repo}.`);
  const card = { user_id: worker.owner_user, folder: start.folder, repo };
  await db.pinCard(worker.id, req.cardId, card);
  return card;
}

async function checkGrant(db: ConnectorDb, worker: WorkerRow, req: SignedMint, now: number): Promise<GrantRow> {
  const grant = await db.grant(worker.owner_user, worker.id, req.connector);
  if (!grant) throw new MintError(403, `GitHub isn't turned on for ${worker.name}. Turn it on in Weft → Settings → Devices → ${worker.name} → Connectors.`);
  if (!isLive(grant.expires_at, now)) throw new MintError(403, `${worker.name}'s GitHub access ended (its lifetime ran out). Turn it on again in Settings → Devices.`);
  return grant;
}

async function decide(deps: TokenDeps, worker: WorkerRow, req: SignedMint, grant: GrantRow): Promise<{ handed: Handed; kind: "user" | "scoped" }> {
  const { db } = deps;
  const project = await cardProject(db, worker, req);
  if (!same(project.repo, req.repo)) throw new MintError(403, `That card's project is ${project.repo}, not ${req.repo}.`);
  const state = await db.cardState(worker.org_id, req.cardId);
  if (state?.deleted || state?.column === "done") throw new MintError(403, "That card is Done or deleted, so it gets no token.");
  const settings = settingsOf(grant);
  const allow = allowSubject(settings.approval, { id: req.cardId, repo: project.repo });
  if (allow && !(await db.hasAllow(grant.id, allow.kind, allow.subject))) {
    throw new MintError(403, `GitHub on ${worker.name} asks per ${allow.kind}: allow this ${allow.kind} in Weft → Settings → Devices → ${worker.name} → Connectors.`, "needs_allow");
  }
  if (settings.scope === "installed") return { handed: await userToken(deps, worker.owner_user), kind: "user" };
  const subject = settings.scope === "project" ? `project:${project.repo.toLowerCase()}` : `card:${req.cardId}`;
  return { handed: await narrowToken(deps, { userId: worker.owner_user, workerId: worker.id, subject, repo: project.repo }), kind: "scoped" };
}

const refusal = (err: unknown): MintAnswer => {
  if (err instanceof MintError) return { status: err.status, body: { error: err.message, ...(err.outcome === "needs_allow" ? { needs: "allow" } : {}) } };
  return { status: 502, body: { error: `Couldn't mint: ${(err as Error).message}` } };
};

export async function mint(deps: TokenDeps, authorization: string | null, raw: unknown): Promise<MintAnswer> {
  const { db } = deps;
  const now = deps.now();
  let req: SignedMint;
  let worker: WorkerRow;
  try {
    req = parseMint(raw);
    worker = await signedWorker(db, authorization, req, now);
    if ((await db.mintsSince(worker.id, new Date(now - 60_000).toISOString())) >= PER_MINUTE || (await db.mintsSince(worker.id, new Date(now - 3_600_000).toISOString())) >= PER_HOUR) {
      throw new MintError(429, "Too many token requests from this worker. Wait a minute.");
    }
  } catch (err) {
    return refusal(err);
  }
  const entry: MintLog = { user_id: worker.owner_user, worker_id: worker.id, grant_id: null, connector: req.connector, card_id: req.cardId, repo: req.repo, outcome: "refused", reason: "in progress", token_kind: null, nonce: req.nonce };
  let id: number | "replay";
  try {
    id = await db.logMint(entry);
  } catch (err) {
    return refusal(err);
  }
  if (id === "replay") return { status: 401, body: { error: "That request was answered already." } };
  try {
    const grant = await checkGrant(db, worker, req, now);
    const { handed, kind } = await decide(deps, worker, req, grant);
    await Promise.all([db.touchGrant(grant.id, new Date(now).toISOString()), db.finishMint(id, { grant_id: grant.id, outcome: "minted", reason: null, token_kind: kind })]);
    return { status: 200, body: { token: handed.token, expiresAt: handedExpiry(handed.issuedAt), login: handed.login, kind, asks: settingsOf(grant).asks } };
  } catch (err) {
    const outcome = err instanceof MintError ? err.outcome : "refused";
    await db.finishMint(id, { outcome, reason: (err as Error).message.slice(0, 300) }).catch(() => undefined);
    return refusal(err);
  }
}
