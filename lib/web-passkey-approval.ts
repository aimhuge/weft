// What a paired browser signs when it answers on weft.zip (docs/architecture/mobile-security.md, "Passkey approvals").
// Only an Allow on a permission request needs a signature (a Deny, or a question's answers, never runs anything on its
// own), and only a browser that paired with a passkey has one to give. The riskiest asks (lib/passkey-phone-only.ts)
// go unsigned, so the Mac sends them to the phone. The approval sheet shows the tool and action out of the
// very message built here, then the passkey signs it.
import { passkeyMessage, type PasskeyAuth } from "./approval-passkey";
import type { GrantScope } from "./cloud-commands";
import type { CloudCardRow } from "./cloud-sync-types";
import { phoneOnly } from "./passkey-phone-only";
import type { PasskeySignature } from "./web-passkey";

export interface ApprovalToSign {
  message: string;
  device: string;
  credId: string;
  issuedAt: number;
}

// Whether this answer is one a passkey signs: an Allow on a permission request that isn't phone-only and grants no
// folder (a grant stays on the phone or the Mac). Synchronous, so an answer that needs none leaves at once.
export function needsPasskey(row: Pick<CloudCardRow, "card">, allow: boolean, grant?: GrantScope): boolean {
  const pending = row.card.pending;
  return !!pending && allow && !grant && !pending.questions?.length && !pending.elicitation && !phoneOnly(pending);
}

export function approvalToSign(
  row: Pick<CloudCardRow, "org_id" | "card_id" | "owner_device" | "folder" | "card">,
  answer: { allow: boolean; answers?: Record<string, string>; grant?: GrantScope },
  passkey: { device: string; credId: string } | null,
  now: number,
): ApprovalToSign | null {
  const pending = row.card.pending;
  if (!passkey || !pending || !needsPasskey(row, answer.allow, answer.grant)) return null;
  const fields = { orgId: row.org_id, macDevice: row.owner_device, cardId: row.card_id, pendingId: pending.id, allow: true, issuedAt: now, answers: answer.answers };
  // The row's org and owner_device come from the server: a wrong one only makes a message the Mac won't match, since
  // the encoding can't be bent into another field (lib/approval-passkey.ts).
  const message = passkeyMessage(fields, { toolName: pending.toolName, input: pending.input, folder: row.folder });
  return { message, device: passkey.device, credId: passkey.credId, issuedAt: now };
}

export const passkeyAuth = (approval: ApprovalToSign, sig: PasskeySignature): PasskeyAuth => ({
  kind: "webauthn",
  device: approval.device,
  credId: approval.credId,
  issuedAt: approval.issuedAt,
  ...sig,
});
