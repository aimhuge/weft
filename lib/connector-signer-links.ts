// The emailed links that make a new Mac key trusted, or revoke it, with no session (docs/architecture/connectors.md#who-may-say-yes-the-chain-of-trust).
// Registering a key mails the account's own address a one-time confirm link and a revoke link; weft.zip keeps only
// their sha256, and every revoke link it ever mailed for the key keeps working. The email's wording is fixed: it shows the key's fingerprint, the time, and the IP and browser the
// registration came from, never the name the registering client chose. Opening a link shows a page with one button
// (app/api/connectors/signers/{confirm,revoke}), so a mail scanner that fetches links can't press it.
import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SignerRow } from "./connector-db-trust";
import { connectorSite } from "./connector-remote";
import { MintError, type TokenDeps } from "./connector-tokens";
import { keyFingerprint } from "./connector-trust";
import { notice } from "./connector-notify";

// A confirm link works this long after it was sent.
export const CONFIRM_MS = 24 * 3_600_000;
// A pending key's link is sent again on a new registration only after this long.
export const RESEND_MS = 10 * 60_000;

export interface RequestMeta {
  ip: string;
  ua: string;
}

// Where a request came from, for the email: Vercel's forwarded address and the browser or client it named.
export function requestMeta(req: Request): RequestMeta {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return { ip: ip.slice(0, 100), ua: (req.headers.get("user-agent") || "unknown").replace(/[^\x20-\x7e]/g, "?").slice(0, 300) };
}

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

// Whether `token` is the one whose hash is kept, in constant time.
export function matches(hash: string | null | undefined, token: unknown): boolean {
  if (!hash || typeof token !== "string" || !token) return false;
  const a = Buffer.from(hash);
  const b = Buffer.from(tokenHash(token));
  return a.length === b.length && timingSafeEqual(a, b);
}

// The id and token go in the fragment, which no browser sends, so they never reach a server log; the page posts them.
export const links = (id: string, confirm: string, revoke: string, site = connectorSite(process.env)) => ({
  confirm: `${site}/api/connectors/signers/confirm#id=${encodeURIComponent(id)}&t=${encodeURIComponent(confirm)}`,
  revoke: `${site}/api/connectors/signers/revoke#id=${encodeURIComponent(id)}&t=${encodeURIComponent(revoke)}`,
});

// At most this many confirm emails per account a day, whatever keys they're for: a stolen session can't flood the inbox.
export const MAILS_PER_DAY = 5;
export const MAIL_REASON = "confirm email sent";

// Whether the account may get another confirm email today.
export const mayMail = async (deps: TokenDeps, userId: string, now: number) =>
  (await deps.db.noticesSince(userId, MAIL_REASON, new Date(now - 24 * 3_600_000).toISOString())) < MAILS_PER_DAY;

// The confirm email, in fixed words, counted in the ledger. Throws when it can't be sent, so the caller can say so.
export async function mailConfirm(deps: TokenDeps, s: Pick<SignerRow, "id" | "user_id" | "sign_key">, tokens: { confirm: string; revoke: string }, meta: RequestMeta, now: number): Promise<void> {
  if (!deps.notify) throw new MintError(503, "This weft.zip can't send email (RESEND_API_KEY isn't set), so a new Mac key can't be confirmed. It stays untrusted.");
  await deps.db.logMint({ user_id: s.user_id, worker_id: null, grant_id: null, connector: "github", card_id: null, repo: null, outcome: "notice", reason: MAIL_REASON, token_kind: null, nonce: null });
  const l = links(s.id, tokens.confirm, tokens.revoke, deps.site);
  const text = [
    "A Mac key was added to your Weft account to approve connectors (GitHub on your workers).",
    `Key fingerprint: ${keyFingerprint(s.sign_key)}`,
    `When: ${new Date(now).toISOString()}`,
    `From IP: ${meta.ip}`,
    `Client: ${meta.ua}`,
    "",
    "If this was you, setting up Weft on a Mac, confirm it (the link works once, for 24 hours):",
    l.confirm,
    "",
    "If it wasn't you, revoke the key (no sign-in needed), then sign out of Weft everywhere: someone may hold a session of yours.",
    l.revoke,
    "",
    "Until it's confirmed, or a Mac you already trust vouches for it in Settings → Devices, the key can approve nothing.",
  ].join("\n");
  await deps.notify(s.user_id, "Weft: confirm a new Mac key", text);
}

// The emailed confirm link, pressed: the key is trusted from now, and the link is spent.
export async function confirmByLink(deps: TokenDeps, id: unknown, token: unknown): Promise<void> {
  const s = typeof id === "string" ? await deps.db.signerById(id) : null;
  const now = deps.now();
  if (!s || s.revoked_at || !matches(s.confirm_hash, token) || !s.confirm_expires_at || Date.parse(s.confirm_expires_at) < now) throw new MintError(404, "That link has been used, has expired, or isn't one Weft sent.");
  await deps.db.trustSigner(s.id, new Date(now).toISOString(), null);
  await notice(deps, s.user_id, { subject: "a Mac key was confirmed for connectors", text: `The Mac key ${keyFingerprint(s.sign_key)} was confirmed from the emailed link. It can now approve connectors for your Weft account.` });
}

// The emailed revoke link, pressed: the key is revoked, with the grants it signed (lib/connector-signers.ts).
export async function revokeByLink(deps: TokenDeps, id: unknown, token: unknown, revoke: (deps: TokenDeps, userId: string, id: string) => Promise<unknown>): Promise<void> {
  const s = typeof id === "string" ? await deps.db.signerById(id) : null;
  if (!s || !(s.revoke_hashes ?? []).some((h) => matches(h, token))) throw new MintError(404, "That link isn't one Weft sent.");
  if (!s.revoked_at) await revoke(deps, s.user_id, s.id);
}
