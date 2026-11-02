// The Mac keys that may say yes to a connector, on weft.zip (docs/architecture/connectors.md#who-may-say-yes-the-chain-of-trust).
// A Mac registers its desktop approval key (electron/desktop-signer.cjs) by signing it; a key is trusted for grants
// once a trusted Mac of yours vouched for it (after Touch ID there), or COOLING_MS after it was registered, and you're
// emailed either way. A session alone (stolen, or a thread holding the account's refresh token) can register a key of
// its own, but it waits out the day in plain sight of that email, and can't make it trusted any sooner. A session can
// always take trust away (revoke a key), which ends the grants that key signed and the tokens under them.
import "server-only";
import { endorseMessage, SIGNER_KEY_RE, signerMessage } from "./connector-messages";
import type { SignerRow } from "./connector-db-trust";
import { MintError, type TokenDeps } from "./connector-tokens";
import { COOLING_MS, fresh, isTrusted, verifyRaw } from "./connector-trust";
import { notice } from "./connector-notify";
import { revokeWorker } from "./connector-revoke";

// At most this many live keys per account, so a session can't flood the list a user reviews.
export const MAX_SIGNERS = 10;

export interface SignerView {
  id: string;
  key: string;
  name: string;
  addedAt: string;
  trustedFrom: string;
  trusted: boolean;
  endorsed: boolean;
}

export const viewOf = (s: SignerRow, now: number): SignerView => ({ id: s.id, key: s.sign_key, name: s.name, addedAt: s.added_at, trustedFrom: s.trusted_from, trusted: isTrusted(s, now), endorsed: Boolean(s.endorsed_by) });

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[^\x20-\x7e]/g, "?").trim().slice(0, max) : "");

// Your Mac keys that aren't revoked, newest first.
export async function listSigners(deps: TokenDeps, userId: string): Promise<SignerView[]> {
  const now = deps.now();
  return (await deps.db.signers(userId)).filter((s) => !s.revoked_at).sort((a, b) => b.added_at.localeCompare(a.added_at)).map((s) => viewOf(s, now));
}

// A Mac offers its key: { key, name, device, issuedAt, sig } with sig by that key over signerMessage. An existing live
// key answers as it is; a new one (or one revoked before) waits COOLING_MS.
export async function registerSigner(deps: TokenDeps, userId: string, raw: unknown): Promise<SignerView> {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const key = typeof b.key === "string" && SIGNER_KEY_RE.test(b.key) ? b.key : null;
  const name = text(b.name, 80) || "A Mac";
  const issuedAt = Number(b.issuedAt);
  const now = deps.now();
  if (!key || typeof b.sig !== "string") throw new MintError(400, "Send the Mac's key, signed.");
  if (!fresh(issuedAt, now)) throw new MintError(401, "That key's signature is too old (or this Mac's clock is off).");
  if (!verifyRaw(key, signerMessage({ userId, key, name, issuedAt }), b.sig)) throw new MintError(401, "That key's signature doesn't check.");
  const was = await deps.db.signerByKey(userId, key);
  if (was && !was.revoked_at) return viewOf(was, now);
  const live = (await deps.db.signers(userId)).filter((s) => !s.revoked_at);
  if (live.length >= MAX_SIGNERS) throw new MintError(409, `You have ${MAX_SIGNERS} Mac keys already. Remove one in Settings → Devices first.`);
  const row = await deps.db.saveSigner({ user_id: userId, sign_key: key, name, device: text(b.device, 100) || null, trusted_from: new Date(now + COOLING_MS).toISOString() });
  await notice(deps, userId, {
    subject: `a new Mac key (${name}) for connectors`,
    text: `A Mac called "${name}" (key ${key.slice(0, 12)}…) asked to approve connectors for your Weft account. It can approve nothing until ${row.trusted_from}, unless a Mac you already trust vouches for it in Settings → Devices.`,
  });
  return viewOf(row, now);
}

// A trusted Mac vouches for another key of yours: { key, by, issuedAt, sig } with sig by `by` over endorseMessage.
// The key vouched for and the trusted Mac vouching, once the vouch's shape, time and signature check.
async function checkedVouch(deps: TokenDeps, userId: string, raw: unknown, now: number): Promise<{ target: SignerRow; by: SignerRow; sig: string }> {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const issuedAt = Number(b.issuedAt);
  if (typeof b.key !== "string" || typeof b.by !== "string" || typeof b.sig !== "string") throw new MintError(400, "Name the key, the Mac vouching for it, and its signature.");
  if (!fresh(issuedAt, now)) throw new MintError(401, "That signature is too old (or this Mac's clock is off).");
  const [target, by] = await Promise.all([deps.db.signerByKey(userId, b.key), deps.db.signerByKey(userId, b.by)]);
  if (!target || target.revoked_at) throw new MintError(404, "That Mac key isn't one of yours.");
  if (!by || !isTrusted(by, now)) throw new MintError(403, "Only a Mac that's trusted now can vouch for another.");
  if (!verifyRaw(by.sign_key, endorseMessage({ userId, key: b.key, by: b.by, issuedAt }), b.sig)) throw new MintError(401, "That signature doesn't check.");
  return { target, by, sig: b.sig };
}

export async function endorseSigner(deps: TokenDeps, userId: string, raw: unknown): Promise<SignerView> {
  const now = deps.now();
  const { target, by, sig } = await checkedVouch(deps, userId, raw, now);
  if (!(await deps.db.takeNonce(userId, `endorse:${sig.slice(0, 40)}`))) throw new MintError(401, "That was taken already.");
  const at = new Date(now).toISOString();
  const already = isTrusted(target, now);
  if (!already) await deps.db.trustSigner(target.id, at, by.id);
  await notice(deps, userId, { subject: `a Mac key (${target.name}) is trusted for connectors`, text: `"${by.name}" vouched for the Mac "${target.name}" (key ${target.sign_key.slice(0, 12)}…). It can now approve connectors for your Weft account.` });
  return viewOf({ ...target, trusted_from: already ? target.trusted_from : at, endorsed_by: already ? target.endorsed_by : by.id }, now);
}

// Takes a key's trust away. The grants it signed go too, and the tokens under them end at GitHub.
export async function revokeSigner(deps: TokenDeps, userId: string, id: string): Promise<{ grants: number }> {
  const signer = await deps.db.signerById(id);
  if (!signer || signer.user_id !== userId) throw new MintError(404, "That Mac key isn't one of yours.");
  await deps.db.revokeSigner(id, new Date(deps.now()).toISOString());
  const grants = await deps.db.grantsBySigner(id);
  for (const g of grants) await revokeWorker(deps, userId, g.worker_id).catch(() => undefined);
  return { grants: grants.length };
}
