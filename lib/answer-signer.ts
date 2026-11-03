// The desktop board's Allow on a worker card (docs/architecture/mobile-security.md, "The desktop signs too"): Electron
// main reads the card's waiting request itself, asks Touch ID in its own words and signs the phone's message
// (lib/approval-sig.ts) with this Mac's approval key (electron/approval-sign.cjs, `weft.approval.sign`). The board sends
// only ids and the decision, and the signature rides as the answer's `auth`, which the worker checks against the key it
// pinned at pairing (lib/worker-approve.ts). A Deny or a question's answers need none. A card on this Mac signs only an
// Allow on a phone-only ask (localSignedAnswer; lib/local-approve.ts checks it). Without the desktop app (weft.zip)
// there's no signer: the answer goes unsigned and the host says how to approve it.
import type { ApprovalAuth } from "./approval-sig";
import type { GrantScope } from "./cloud-commands";
import { phoneOnlyAllow } from "./passkey-phone-only";
import type { Card } from "./types";
import { CANCELLED } from "./widen-signer";

export type SignRequest = { cardId: string; pendingId: string; allow: boolean; answers?: Record<string, string>; grant?: GrantScope };
type Signed = ApprovalAuth & { publicKey?: string };
type Bridge = { sign?: (req: SignRequest) => Promise<Signed | null> };

const bridge = (): Bridge | undefined =>
  typeof window === "undefined" ? undefined : (window as unknown as { weft?: { approval?: Bridge } }).weft?.approval;

// Whether this answer runs something: an Allow on a permission request (not a question or a form).
export function needsSignature(card: Pick<Card, "pending">, allow: boolean): boolean {
  const pending = card.pending;
  return Boolean(pending) && allow && !pending?.questions?.length && !pending?.elicitation;
}

// The signature for an Allow on a worker card, after Touch ID; undefined when it needs none or there's no signer.
// Throws when the person says no, so nothing is sent.
export function signedAnswer(card: Pick<Card, "id" | "pending">, allow: boolean, extra: Extra = {}): Promise<ApprovalAuth | undefined> {
  return needsSignature(card, allow) ? sign(card, allow, extra) : Promise.resolve(undefined);
}

// The same for a card on this Mac, whose Allow is signed only on a phone-only ask (a vault tool, skipping permissions,
// an agent's config: lib/passkey-phone-only.ts). Without a signer the route refuses it and says why.
export function localSignedAnswer(card: Pick<Card, "id" | "pending">, allow: boolean, extra: Extra = {}): Promise<ApprovalAuth | undefined> {
  return phoneOnlyAllow(card.pending, allow) ? sign(card, allow, extra) : Promise.resolve(undefined);
}

type Extra = { answers?: Record<string, string>; grant?: GrantScope };

async function sign(card: Pick<Card, "id" | "pending">, allow: boolean, extra: Extra): Promise<ApprovalAuth | undefined> {
  const pendingId = card.pending?.id;
  const signer = bridge()?.sign;
  if (!pendingId || !signer) return undefined;
  const got = await signer({ cardId: card.id, pendingId, allow, ...(extra.answers ? { answers: extra.answers } : {}), ...(extra.grant ? { grant: extra.grant } : {}) });
  if (!got) throw new Error(CANCELLED);
  // Only what the worker reads: main's public key stays out of the row.
  return { device: got.device, issuedAt: got.issuedAt, sig: got.sig };
}
