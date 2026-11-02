// The signed writes on weft.zip (docs/architecture/connectors.md#who-may-say-yes-the-chain-of-trust): a grant, an Allow,
// a worker vouched for. Each comes from Electron main after Touch ID, signed with this Mac's approval key, and lands
// only if the key is one of your registered Mac keys and the signature checks over exactly what's written. Trust is
// checked again by the mint (lib/connector-trust.ts), against keys trusted then, so a key still waiting out its day
// can write, and nothing it signed mints until it's trusted.
import "server-only";
import { looser, settingsOf, CONNECTORS, REPO_RE, type Connector } from "./connector-grant";
import { allowMessage, grantMessage, workerMessage } from "./connector-messages";
import type { SignerRow } from "./connector-db-trust";
import { MintError, type TokenDeps } from "./connector-tokens";
import { fresh, isTrusted, keyFingerprint, verifyRaw } from "./connector-trust";
import type { RequestMeta } from "./connector-signer-links";
import { notice } from "./connector-notify";
import { endWorkerTokens } from "./connector-revoke";

type Body = Record<string, unknown>;
const bodyOf = (raw: unknown): Body => (raw && typeof raw === "object" ? (raw as Body) : {});
const NONCE_RE = /^[0-9a-f]{32,64}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;

// The registered (not revoked) key of yours that signed, or a refusal.
async function signerOf(deps: TokenDeps, userId: string, key: unknown): Promise<SignerRow> {
  const signer = typeof key === "string" ? await deps.db.signerByKey(userId, key) : null;
  if (!signer || signer.revoked_at) throw new MintError(403, "This Mac's key isn't registered for connectors. Open Settings → Devices on it once, then try again.");
  return signer;
}

// A signed statement's time and nonce: fresh, and taken once.
async function takeFresh(deps: TokenDeps, userId: string, b: Body): Promise<{ nonce: string; issuedAt: number }> {
  const issuedAt = Number(b.issuedAt);
  if (typeof b.nonce !== "string" || !NONCE_RE.test(b.nonce)) throw new MintError(400, "Send a nonce.");
  if (!fresh(issuedAt, deps.now())) throw new MintError(401, "That approval is too old (or this Mac's clock is off).");
  if (!(await deps.db.takeNonce(userId, b.nonce))) throw new MintError(401, "That approval was used already.");
  return { nonce: b.nonce, issuedAt };
}

// A key not trusted yet: its grants mint nothing until it's confirmed from the email or vouched for.
const waiting = (s: SignerRow, now: number) => !isTrusted(s, now);
const from = (meta?: RequestMeta) => (meta ? ` From IP ${meta.ip}, client ${meta.ua}.` : "");

// A worker vouched for: { workerId, signKey, boxKey, signerKey, sig }. Its row must have that sign key now.
export async function pinWorker(deps: TokenDeps, userId: string, raw: unknown, meta?: RequestMeta): Promise<{ ok: true; waiting: boolean }> {
  const b = bodyOf(raw);
  if (typeof b.workerId !== "string" || !UUID_RE.test(b.workerId) || typeof b.signKey !== "string" || typeof b.boxKey !== "string" || typeof b.sig !== "string") throw new MintError(400, "Name the worker, its keys and the signature.");
  const signer = await signerOf(deps, userId, b.signerKey);
  const worker = await deps.db.workerById(b.workerId);
  if (!worker || worker.owner_user !== userId || worker.revoked_at) throw new MintError(404, "That isn't a worker of yours.");
  if (worker.sign_key !== b.signKey) throw new MintError(409, `${worker.name}'s pairing key isn't the one this Mac pinned. Pair it again from Settings → Devices.`);
  if (!verifyRaw(signer.sign_key, workerMessage({ userId, workerId: worker.id, signKey: b.signKey, boxKey: b.boxKey }), b.sig)) throw new MintError(401, "That signature doesn't check.");
  const was = await deps.db.workerPin(worker.id);
  await deps.db.savePin({ worker_id: worker.id, user_id: userId, sign_key: b.signKey, box_key: b.boxKey, signer_id: signer.id, sig: b.sig });
  if (!was || was.sign_key !== b.signKey) await notice(deps, userId, { workerId: worker.id, subject: "a worker was vouched for", text: `The Mac key ${keyFingerprint(signer.sign_key)} vouched for the worker ${worker.id} (pairing key ${keyFingerprint(b.signKey)}), so it can ask for connector tokens once one is turned on for it.${from(meta)}` });
  return { ok: true, waiting: waiting(signer, deps.now()) };
}

// A grant turned on or changed: { workerId, connector, settings, nonce, issuedAt, prevEpoch, signerKey, sig }. It lands
// only at the epoch the signature named, so a signed change can't re-create a grant turned off since. A stricter one
// ends the worker's tokens, so it takes effect now rather than at the next rotation.
function parseGrant(raw: unknown) {
  const b = bodyOf(raw);
  const connector = b.connector as Connector;
  const prevEpoch = Number(b.prevEpoch);
  const repos = reposOf(b.repos);
  const shaped = typeof b.workerId === "string" && UUID_RE.test(b.workerId) && CONNECTORS.includes(connector) && Number.isInteger(prevEpoch) && prevEpoch >= 0 && typeof b.sig === "string" && repos;
  if (!shaped) throw new MintError(400, "Name the worker, the connector, the repos, the epoch and the signature.");
  return { b, workerId: b.workerId as string, connector, prevEpoch, repos, sig: b.sig as string, settings: settingsOf(b.settings), issuedAt: Number(b.issuedAt), nonce: String(b.nonce) };
}

// The repos a grant covers: lowercase owner/name, at most 500, or null for anything else.
function reposOf(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length > 500) return null;
  const ok = raw.every((r): r is string => typeof r === "string" && REPO_RE.test(r) && r === r.toLowerCase());
  return ok ? [...new Set(raw)].sort() : null;
}

// A paired worker of the user's that a Mac has vouched for, at the sign key its row has now.
async function vouchedWorker(deps: TokenDeps, userId: string, workerId: string) {
  const worker = await deps.db.workerById(workerId);
  if (!worker || worker.owner_user !== userId || worker.revoked_at || !worker.sign_key) throw new MintError(404, "That isn't a paired worker of yours.");
  const pin = await deps.db.workerPin(worker.id);
  if (!pin || pin.sign_key !== worker.sign_key) throw new MintError(409, `No Mac has vouched for ${worker.name}'s pairing yet.`);
  return worker;
}

const CHANGED = "GitHub on that worker changed since you looked. Try again.";

export async function writeGrant(deps: TokenDeps, userId: string, raw: unknown, meta?: RequestMeta): Promise<{ ok: true; epoch: number; waiting: boolean; tokensRevoked: number }> {
  const g = parseGrant(raw);
  const signer = await signerOf(deps, userId, g.b.signerKey);
  const worker = await vouchedWorker(deps, userId, g.workerId);
  const statement = { userId, workerId: worker.id, connector: g.connector, settings: g.settings, repos: g.repos, nonce: g.nonce, issuedAt: g.issuedAt, prevEpoch: g.prevEpoch };
  if (!verifyRaw(signer.sign_key, grantMessage(statement), g.sig)) throw new MintError(401, "That approval's signature doesn't check.");
  await takeFresh(deps, userId, g.b);
  const was = await deps.db.grant(userId, worker.id, g.connector);
  if ((was?.epoch ?? 0) !== g.prevEpoch) throw new MintError(409, CHANGED);
  const row = { user_id: userId, worker_id: worker.id, connector: g.connector, ...g.settings, repos: g.repos, signer_id: signer.id, sig: g.sig, nonce: g.nonce, issued_at: new Date(g.issuedAt).toISOString(), epoch: g.prevEpoch + 1 };
  if (!(await deps.db.writeGrant(row, g.prevEpoch))) throw new MintError(409, CHANGED);
  let tokensRevoked = 0;
  if (was && (looser(g.settings, settingsOf(was)) || was.repos.some((r) => !g.repos.includes(r)))) tokensRevoked = (await endWorkerTokens(deps, userId, worker.id)).tokensRevoked;
  if (!was) await notice(deps, userId, { workerId: worker.id, subject: "GitHub was turned on for a worker", text: `The Mac key ${keyFingerprint(signer.sign_key)} turned GitHub on for the worker ${worker.id}: cards started on it from your board can push and use gh as you, with Weft.${from(meta)}` });
  return { ok: true, epoch: g.prevEpoch + 1, waiting: waiting(signer, deps.now()), tokensRevoked };
}

// An Allow for a project or card: { grantId, kind, subject, nonce, issuedAt, signerKey, sig }.
export async function writeAllow(deps: TokenDeps, userId: string, raw: unknown): Promise<{ ok: true }> {
  const b = bodyOf(raw);
  const kind = b.kind;
  if (typeof b.grantId !== "string" || (kind !== "project" && kind !== "card") || typeof b.subject !== "string" || !b.subject || b.subject.length > 201 || typeof b.sig !== "string") throw new MintError(400, "Name the grant, the project or card, and the signature.");
  const signer = await signerOf(deps, userId, b.signerKey);
  const grant = await deps.db.grantById(b.grantId);
  if (!grant || grant.user_id !== userId) throw new MintError(404, "That isn't a grant of yours.");
  const issuedAt = Number(b.issuedAt);
  const nonce = String(b.nonce);
  if (!verifyRaw(signer.sign_key, allowMessage({ userId, grantId: b.grantId, kind, subject: b.subject, nonce, issuedAt }), b.sig)) throw new MintError(401, "That Allow's signature doesn't check.");
  await takeFresh(deps, userId, b);
  await deps.db.saveAllow({ grant_id: b.grantId, user_id: userId, kind, subject: b.subject, signer_id: signer.id, sig: b.sig, nonce, issued_at: new Date(issuedAt).toISOString() });
  return { ok: true };
}
