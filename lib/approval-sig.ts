// Signed approvals from a paired phone (docs/architecture/mobile-security.md, "Signed approvals"). The phone signs this
// message with its Ed25519 key, which it only reads after Face ID; the Mac checks it against the key it pinned at
// pairing (electron/paired-devices.cjs). Every field that decides what runs is in the message, so a signature can't be
// moved onto another Mac, card, request, decision or set of answers.
import { b64, unb64, type Sodium } from "./sodium";

// How far issuedAt may be from the Mac's clock. A pending request answers once, so a replay inside it finds nothing.
export const APPROVAL_MAX_SKEW_MS = 5 * 60_000;

export interface ApprovalFields {
  orgId: string;
  // The Mac the command is addressed to (cloud_commands.target_device).
  macDevice: string;
  cardId: string;
  pendingId: string;
  allow: boolean;
  issuedAt: number;
  answers?: Record<string, string>;
}

// What rides beside the answer payload (cloud_commands.payload.auth).
export interface ApprovalAuth {
  device: string;
  issuedAt: number;
  sig: string;
}

// The answers as canonical JSON: keys sorted, so the phone and the Mac hash the same bytes.
export const canonicalAnswers = (answers: Record<string, string>) =>
  JSON.stringify(Object.fromEntries(Object.keys(answers).sort().map((k) => [k, answers[k]])));

function answersHash(s: Sodium, answers?: Record<string, string>): string {
  if (!answers || !Object.keys(answers).length) return "-";
  return s.to_hex(s.crypto_generichash(32, s.from_string(canonicalAnswers(answers))));
}

export function approvalMessage(s: Sodium, f: ApprovalFields): string {
  return ["weft-approval-v1", f.orgId, f.macDevice, f.cardId, f.pendingId, f.allow ? "allow" : "deny", String(f.issuedAt), answersHash(s, f.answers)].join("\n");
}

// The phone's half, here for tests and as the reference the phone app copies.
export const signApproval = (s: Sodium, message: string, signPrivateKey: string) => b64(s, s.crypto_sign_detached(s.from_string(message), unb64(s, signPrivateKey)));

export function verifyApproval(s: Sodium, message: string, sig: string, signPublicKey: string): boolean {
  try {
    return s.crypto_sign_verify_detached(unb64(s, sig), s.from_string(message), unb64(s, signPublicKey));
  } catch {
    return false;
  }
}

export const freshEnough = (issuedAt: number, now: number) => Number.isFinite(issuedAt) && Math.abs(now - issuedAt) <= APPROVAL_MAX_SKEW_MS;

// The auth off the network: each field the type it must be, or null.
export function readApprovalAuth(raw: unknown): ApprovalAuth | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.device !== "string" || typeof a.sig !== "string" || typeof a.issuedAt !== "number") return null;
  if (!a.device || a.sig.length > 200) return null;
  return { device: a.device, issuedAt: a.issuedAt, sig: a.sig };
}
