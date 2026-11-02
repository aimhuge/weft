// The Mac keys that may say yes to a connector, on weft.zip (docs/architecture/connectors.md#who-may-say-yes-the-chain-of-trust).
// A Mac registers its desktop approval key (electron/desktop-signer.cjs) by signing it, once, after a Touch ID. A new
// key is trusted only when someone opens the one-time link mailed to the account's own address
// (lib/connector-signer-links.ts), or when a trusted Mac of yours vouches for it after Touch ID there; there's no path
// by time alone, and with no mailer set up a new key can't be registered at all. A session alone (stolen, or a thread
// holding the account's refresh token) can register a key of its own, but can't confirm it without the inbox. A session
// can always take trust away (revoke a key), which ends the grants that key signed, its worker pins and their tokens.
import "server-only";
import { endorseMessage, SIGNER_KEY_RE, signerMessage } from "./connector-messages";
import type { SignerRow } from "./connector-db-trust";
import { MintError, type TokenDeps } from "./connector-tokens";
import { fresh, isTrusted, keyFingerprint, verifyRaw } from "./connector-trust";
import { notice } from "./connector-notify";
import { revokeWorker } from "./connector-revoke";
import { CONFIRM_MS, mailConfirm, newToken, RESEND_MS, tokenHash, type RequestMeta } from "./connector-signer-links";

// At most this many live keys per account, so a session can't flood the list a user reviews.
export const MAX_SIGNERS = 10;
// A pending key's confirm email goes out at most this many times.
export const MAX_SENDS = 4;

export interface SignerView {
  id: string;
  key: string;
  name: string;
  addedAt: string;
  trustedFrom: string | null;
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

// The key the offer names, once its own signature over {you, key, name, time} checks.
function checkedOffer(userId: string, raw: unknown, now: number) {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const key = typeof b.key === "string" && SIGNER_KEY_RE.test(b.key) ? b.key : null;
  const name = text(b.name, 80) || "A Mac";
  const issuedAt = Number(b.issuedAt);
  if (!key || typeof b.sig !== "string") throw new MintError(400, "Send the Mac's key, signed.");
  if (!fresh(issuedAt, now)) throw new MintError(401, "That key's signature is too old (or this Mac's clock is off).");
  if (!verifyRaw(key, signerMessage({ userId, key, name, issuedAt }), b.sig)) throw new MintError(401, "That key's signature doesn't check.");
  return { key, name, device: text(b.device, 100) || null };
}

const confirmFields = (confirm: string, now: number) => ({ confirm_hash: tokenHash(confirm), confirm_expires_at: new Date(now + CONFIRM_MS).toISOString(), confirm_sent_at: new Date(now).toISOString() });

// A pending key's link, sent again when the last one is old enough (a lost email shouldn't strand a Mac), at most
// MAX_SENDS times in all. Each email's revoke link keeps working: its hash joins the ones sent before.
async function resend(deps: TokenDeps, s: SignerRow, meta: RequestMeta, now: number) {
  if (s.confirm_sent_at && now - Date.parse(s.confirm_sent_at) < RESEND_MS) return;
  const sends = s.confirm_sends ?? 0;
  if (sends >= MAX_SENDS) return;
  const confirm = newToken();
  const revoke = newToken();
  await deps.db.setConfirm(s.id, { ...confirmFields(confirm, now), confirm_sends: sends + 1, revoke_hashes: [...(s.revoke_hashes ?? []), tokenHash(revoke)] });
  await mailConfirm(deps, s, { confirm, revoke }, meta, now).catch(() => deps.db.setConfirm(s.id, { confirm_hash: null, confirm_expires_at: null, confirm_sent_at: null }));
}

// A Mac offers its key: { key, name, device, issuedAt, sig } with sig by that key over signerMessage. A trusted key
// answers as it is; a pending one gets its link again (now and then); a new one, or one revoked before, is added
// untrusted and its confirm link mailed. With no mailer, nothing is added.
export async function registerSigner(deps: TokenDeps, userId: string, raw: unknown, meta: RequestMeta): Promise<SignerView> {
  const now = deps.now();
  const offer = checkedOffer(userId, raw, now);
  if (!deps.notify) throw new MintError(503, "This weft.zip can't send email (RESEND_API_KEY isn't set), so a new Mac key can't be confirmed. Ask whoever runs it to set that up.");
  const was = await deps.db.signerByKey(userId, offer.key);
  if (was && !was.revoked_at) {
    if (!isTrusted(was, now)) await resend(deps, was, meta, now);
    return viewOf(was, now);
  }
  const live = (await deps.db.signers(userId)).filter((s) => !s.revoked_at);
  if (live.length >= MAX_SIGNERS) throw new MintError(409, `You have ${MAX_SIGNERS} Mac keys already. Remove one in Settings → Devices first.`);
  const confirm = newToken();
  const revoke = newToken();
  const row = await deps.db.saveSigner({ user_id: userId, sign_key: offer.key, name: offer.name, device: offer.device, trusted_from: null, ...confirmFields(confirm, now), confirm_sends: 1, revoke_hashes: [tokenHash(revoke)], added_ip: meta.ip, added_ua: meta.ua });
  try {
    await mailConfirm(deps, row, { confirm, revoke }, meta, now);
  } catch {
    await deps.db.setConfirm(row.id, { confirm_hash: null, confirm_expires_at: null, confirm_sent_at: null });
    throw new MintError(502, "The confirmation email couldn't be sent, so this Mac's key isn't trusted. Try again in a minute.");
  }
  return viewOf(row, now);
}

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

// A trusted Mac vouches for another key of yours: { key, by, issuedAt, sig } with sig by `by` over endorseMessage.
export async function endorseSigner(deps: TokenDeps, userId: string, raw: unknown): Promise<SignerView> {
  const now = deps.now();
  const { target, by, sig } = await checkedVouch(deps, userId, raw, now);
  if (!(await deps.db.takeNonce(userId, `endorse:${sig.slice(0, 40)}`))) throw new MintError(401, "That was taken already.");
  const at = new Date(now).toISOString();
  const already = isTrusted(target, now);
  if (!already) await deps.db.trustSigner(target.id, at, by.id);
  await notice(deps, userId, { subject: "a Mac key was vouched for", text: `The trusted Mac key ${keyFingerprint(by.sign_key)} vouched for the Mac key ${keyFingerprint(target.sign_key)}. It can now approve connectors for your Weft account.` });
  return viewOf({ ...target, trusted_from: already ? target.trusted_from : at, endorsed_by: already ? target.endorsed_by : by.id }, now);
}

// Takes a key's trust away. The grants it signed go too, with the tokens under them, and the worker pins it signed.
export async function revokeSigner(deps: TokenDeps, userId: string, id: string): Promise<{ grants: number }> {
  const signer = await deps.db.signerById(id);
  if (!signer || signer.user_id !== userId) throw new MintError(404, "That Mac key isn't one of yours.");
  await deps.db.revokeSigner(id, new Date(deps.now()).toISOString());
  await deps.db.dropPinsBySigner(id);
  const grants = await deps.db.grantsBySigner(id);
  for (const g of grants) await revokeWorker(deps, userId, g.worker_id).catch(() => undefined);
  return { grants: grants.length };
}
