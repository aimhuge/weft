// Who may say yes to a connector on weft.zip (docs/architecture/connectors.md#who-may-say-yes-the-chain-of-trust): a
// Mac's desktop approval key, registered as a signer, trusted once a trusted Mac vouched for it or COOLING_MS after it
// was registered (and you were emailed). Every grant, Allow and worker pin carries a signature by a signer; the routes
// check it on the way in and the mint (lib/connector-mint.ts) checks it again, against signers trusted now.
import "server-only";
import { createPublicKey, verify } from "node:crypto";
import { allowMessage, grantMessage, workerMessage } from "./connector-messages";
import { settingsOf } from "./connector-grant";
import type { AllowRow, GrantRow, WorkerRow } from "./connector-db";
import type { SignerRow, TrustDb, WorkerPin } from "./connector-db-trust";

// A new Mac key waits this long before it may approve anything, unless a trusted Mac vouches for it.
export const COOLING_MS = 24 * 3_600_000;
// A signed statement is taken within this long of its time, and its nonce once.
export const SIGNED_FRESH_MS = 2 * 60_000;

// The DER header that makes a raw 32-byte Ed25519 public key an SPKI key node:crypto reads.
const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");

// Whether `sig` over `message` is by the raw Ed25519 key `key` (libsodium's base64), never throwing.
export function verifyRaw(key: string, message: string, sig: string): boolean {
  try {
    const raw = Buffer.from(key, "base64");
    if (raw.length !== 32) return false;
    const pub = createPublicKey({ key: Buffer.concat([ED25519_SPKI, raw]), format: "der", type: "spki" });
    return verify(null, Buffer.from(message), pub, Buffer.from(sig, "base64"));
    /* v8 ignore start -- Node answers false for any 32-byte key and any signature bytes today; kept so a stricter Node refuses instead of throwing */
  } catch {
    return false;
  }
  /* v8 ignore stop */
}

export const isTrusted = (s: Pick<SignerRow, "trusted_from" | "revoked_at"> | null | undefined, now: number): boolean =>
  Boolean(s && !s.revoked_at && Date.parse(s.trusted_from) <= now);

// The signer behind a row, when it's the user's and trusted now; null otherwise.
async function trustedSigner(db: TrustDb, userId: string, signerId: string | null, now: number): Promise<SignerRow | null> {
  if (!signerId) return null;
  const signer = await db.signerById(signerId);
  return signer && signer.user_id === userId && isTrusted(signer, now) ? signer : null;
}

// The grant as a signer said it, or a reason it isn't: its signature must check against a signer of yours trusted now.
export async function grantProblem(db: TrustDb, grant: GrantRow, now: number): Promise<string | null> {
  const signer = await trustedSigner(db, grant.user_id, grant.signer_id, now);
  if (!signer) return "That grant isn't signed by a Mac of yours that's trusted now.";
  const message = grantMessage({ userId: grant.user_id, workerId: grant.worker_id, connector: grant.connector, settings: settingsOf(grant), nonce: grant.nonce, issuedAt: Date.parse(grant.issued_at), prevEpoch: grant.epoch - 1 });
  // settingsOf drops what it doesn't know; a row it changed isn't the one that was signed.
  const exact = settingsOf(grant);
  if (exact.scope !== grant.scope || exact.approval !== grant.approval || exact.lifetime !== grant.lifetime) return "That grant's settings aren't ones a Mac signs.";
  return verifyRaw(signer.sign_key, message, grant.sig) ? null : "That grant's signature doesn't check.";
}

export async function allowProblem(db: TrustDb, allow: AllowRow, userId: string, now: number): Promise<string | null> {
  const signer = await trustedSigner(db, userId, allow.signer_id, now);
  if (!signer) return "That Allow isn't signed by a Mac of yours that's trusted now.";
  const message = allowMessage({ userId, grantId: allow.grant_id, kind: allow.kind as "project" | "card", subject: allow.subject, nonce: allow.nonce, issuedAt: Date.parse(allow.issued_at) });
  return verifyRaw(signer.sign_key, message, allow.sig) ? null : "That Allow's signature doesn't check.";
}

// Whether the worker was vouched for by a Mac of yours that's trusted now, for the sign key its row has now.
export async function pinProblem(db: TrustDb, worker: WorkerRow, now: number): Promise<string | null> {
  const pin: WorkerPin | null = await db.workerPin(worker.id);
  if (!pin || pin.user_id !== worker.owner_user || pin.sign_key !== worker.sign_key) return `No Mac of yours has vouched for ${worker.name}'s pairing. Turn GitHub on for it again from the Mac that paired it.`;
  const signer = await trustedSigner(db, worker.owner_user, pin.signer_id, now);
  if (!signer) return `The Mac that vouched for ${worker.name} isn't trusted now.`;
  const message = workerMessage({ userId: worker.owner_user, workerId: worker.id, signKey: pin.sign_key, boxKey: pin.box_key });
  return verifyRaw(signer.sign_key, message, pin.sig) ? null : `${worker.name}'s pairing signature doesn't check.`;
}

export const fresh = (issuedAt: number, now: number) => Number.isFinite(issuedAt) && Math.abs(now - issuedAt) <= SIGNED_FRESH_MS;
