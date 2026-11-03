// The Mac's rule for an answer that came from the web or a phone (docs/architecture/mobile-security.md, "Signed
// approvals"), run by lib/cloud-inbox.ts before answerPermission. A signed answer must be a paired phone's, fresh, and
// over exactly this request; an unsigned Allow on a permission request goes through only while no phone is paired or
// Settings → Sync lets the web approve. A Deny, or a question's answers, never needs a signature. A browser's passkey
// signature (auth.kind "webauthn") takes lib/approval-passkey-check.ts instead, under the same rules.
import { readPasskeyAuth } from "./approval-passkey";
import { passkeyProblem, type PasskeyDeps } from "./approval-passkey-check";
import { approvalMessage, freshEnough, readApprovalAuth } from "./approval-sig";
import type { AnswerPayload, CloudCommandRow } from "./cloud-commands";
import { sodium } from "./sodium";
import type { PendingPermission } from "./types";

export interface ApprovalDeps {
  // Electron main's answer for a signature (POST /pairing/verify).
  verify: (body: { device: string; message: string; sig: string }) => Promise<{ ok: boolean; reason?: string }>;
  // How many paired phones can approve (POST /pairing/status).
  approvers: () => Promise<number>;
  webApprovals: boolean;
  now: number;
  // The passkey half: this Mac's own names and main's check. Absent, a passkey answer is refused.
  passkey?: PasskeyDeps;
  // What an unsigned Allow is refused with, when this host words it its own way (a worker: lib/worker-approve.ts).
  unsigned?: string;
}

export const UNSIGNED_REFUSED = "Approve this on your paired phone: an Allow from the web needs Face ID there. (Settings → Sync can let the web approve.)";

const authOf = (payload: unknown): unknown => (payload && typeof payload === "object" ? (payload as Record<string, unknown>).auth : undefined);

// Why this answer can't run, or null when it can.
export async function approvalProblem(
  command: Pick<CloudCommandRow, "org_id" | "target_device" | "payload">,
  answer: AnswerPayload,
  pending: PendingPermission | null | undefined,
  deps: ApprovalDeps,
): Promise<string | null> {
  const given = authOf(command.payload);
  const passkey = readPasskeyAuth(given);
  if (passkey) return passkeyProblem(answer, pending, passkey, deps.now, deps.passkey);
  const auth = readApprovalAuth(given);
  if (auth) {
    if (!freshEnough(auth.issuedAt, deps.now)) return "That approval is too old, or the phone's clock is off. Try again from the phone.";
    const s = await sodium();
    const message = approvalMessage(s, {
      orgId: command.org_id,
      macDevice: command.target_device,
      cardId: answer.cardId,
      pendingId: answer.pendingId,
      allow: answer.allow,
      issuedAt: auth.issuedAt,
      answers: answer.answers,
      grant: answer.grant,
    });
    const r = await deps.verify({ device: auth.device, message, sig: auth.sig });
    return r.ok ? null : (r.reason ?? "That approval's signature doesn't check out.");
  }
  // A question's answers and a Deny don't run anything on their own.
  const isPermission = !pending?.questions?.length && !pending?.elicitation;
  if (!answer.allow || !isPermission) return null;
  if (deps.webApprovals) return null;
  return (await deps.approvers()) > 0 ? (deps.unsigned ?? UNSIGNED_REFUSED) : null;
}
