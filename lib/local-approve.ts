// This Mac's rule for an answer to its own card from its own window (POST /api/cards/<id>/permission;
// docs/architecture/mobile-security.md, "A local card's Allow"). The window's launch token already keeps a thread's curl
// out (lib/guard.ts elevated); on top of it, an Allow on a phone-only ask (a vault tool, skipping permissions, writing an
// agent's config: lib/passkey-phone-only.ts) must carry main's signature, made after Touch ID in main's own words
// (electron/approval-sign.cjs). So a board-side script, which holds the token but can't reach Touch ID, can't allow
// one. Any signature the body carries is checked on the same path a network answer takes (lib/approval-check.ts
// signedProblem, then main's POST /pairing/verify), over this Mac's own id and the workspace "local": a local
// signature never checks out on the network path, which rebuilds the message with the command's real workspace.
// A plain Allow, a Deny and a question's answers need none, as before.
import { signedProblem } from "./approval-check";
import { readApprovalAuth } from "./approval-sig";
import { phoneOnlyAllow } from "./passkey-phone-only";
import type { Card } from "./types";

// The workspace a local card's signed answer names (electron/approval-sign.cjs findRequest signs over the same).
export const LOCAL_ORG = "local";

export const LOCAL_UNSIGNED =
  "Allowing that takes Touch ID: it reaches a vault secret, skips permissions or changes an agent's settings. Allow it on the card in Weft's own window (reopen Weft if it doesn't ask).";
export const LOCAL_MALFORMED = "That approval's signature is malformed.";
export const LOCAL_GONE = "That request isn't waiting any more.";

export interface LocalAnswer {
  allow?: unknown;
  answers?: unknown;
  pendingId?: unknown;
  auth?: unknown;
}

export interface LocalApproveDeps {
  // Main's answer for a signature (POST /pairing/verify): this Mac's own key, or a phone it paired.
  verify: (body: { device: string; message: string; sig: string }) => Promise<{ ok: boolean; reason?: string }>;
  // This Mac's lib/device-id.ts id.
  self: string;
  now: number;
}

const answersOf = (v: unknown): Record<string, string> | undefined =>
  v && typeof v === "object" && Object.values(v).every((a) => typeof a === "string") ? (v as Record<string, string>) : undefined;

// Why this answer can't run, or null when it can.
export async function localApprovalProblem(card: Pick<Card, "id" | "pending">, body: LocalAnswer, deps: LocalApproveDeps): Promise<string | null> {
  const allow = body.allow === true;
  if (body.auth === undefined || body.auth === null) return phoneOnlyAllow(card.pending, allow) ? LOCAL_UNSIGNED : null;
  // Ed25519 only (main's key, or a phone's): a passkey's auth, which signs for weft.zip's board, and anything else that
  // doesn't read as one, is refused outright.
  const auth = readApprovalAuth(body.auth);
  if (!auth) return LOCAL_MALFORMED;
  const pendingId = body.pendingId;
  if (!card.pending || typeof pendingId !== "string" || pendingId !== card.pending.id) return LOCAL_GONE;
  const answers = answersOf(body.answers);
  return signedProblem({ org_id: LOCAL_ORG, target_device: deps.self }, { cardId: card.id, pendingId, allow, ...(answers ? { answers } : {}) }, auth, deps);
}
