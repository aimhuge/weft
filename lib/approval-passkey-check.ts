// The host's check of a passkey-signed answer from weft.zip (docs/architecture/mobile-security.md, "Passkey approvals"),
// run by lib/approval-check.ts when the answer's auth is a WebAuthn assertion. The same rules as the phone's Ed25519
// path: fresh (issuedAt within 5 minutes), over exactly this request (a pending id answers once, so a replay finds
// nothing waiting), from a device this Mac pinned. The message is rebuilt from this Mac's own workspace and device id
// and its own pending request, not from the command row's fields, which the server writes. Electron main checks the
// assertion against the pinned key and keeps the counter in the same step (POST /pairing/passkey-verify).
import { BIDI, BIDI_REFUSED, canonicalJson, passkeyMessage, type PasskeyAuth } from "./approval-passkey";
import { freshEnough } from "./approval-sig";
import type { AnswerPayload } from "./cloud-commands";
import { redactValue } from "./cloud-sync-redact";
import { phoneOnly, PHONE_ONLY } from "./passkey-phone-only";
import type { PendingPermission } from "./types";

export interface PasskeyDeps {
  // This Mac as it names itself: its workspace, its lib/device-id.ts id, and the card's folder on this Mac.
  self: { orgId: string; macDevice: string; folder: string };
  // Main's check of the assertion over the message, against the pin; the counter is kept on success.
  verify: (body: { device: string; credId: string; message: string; authenticatorData: string; clientDataJSON: string; signature: string }) => Promise<{ ok: boolean; reason?: string }>;
}

export const NO_PASSKEYS = "This Mac can't check passkey approvals yet. Approve it on your phone or here.";
// The browser must have been shown everything it signs: an input the sync redacted, or one too long to show, stays here.
export const NOT_SHOWN = "Part of that request is hidden on the web (it looks like a secret) or too long to show, so approve it on your phone or this Mac.";
export const MAX_SIGNED_INPUT = 64 * 1024;
// A folder grant from a passkey would last (Always) on a folder the passkey never saw: grants stay on the phone or the Mac.
export const GRANT_PHONE_ONLY = "Granting a folder needs your phone or this Mac. Allow it once from here, or grant it there.";


export async function passkeyProblem(answer: AnswerPayload, pending: PendingPermission | null | undefined, auth: PasskeyAuth, now: number, deps: PasskeyDeps | undefined): Promise<string | null> {
  if (!deps) return NO_PASSKEYS;
  if (!freshEnough(auth.issuedAt, now)) return "That approval is too old, or this browser's clock is off. Try again.";
  if (!pending || pending.id !== answer.pendingId) return "That request isn't waiting any more.";
  if (answer.grant) return GRANT_PHONE_ONLY;
  if (phoneOnly(pending)) return PHONE_ONLY;
  const input = canonicalJson(pending.input);
  if (BIDI.test(input)) return BIDI_REFUSED;
  if (input !== canonicalJson(redactValue(pending.input)) || input.length > MAX_SIGNED_INPUT) return NOT_SHOWN;
  const { folder, ...self } = deps.self;
  const fields = { ...self, cardId: answer.cardId, pendingId: answer.pendingId, allow: answer.allow, issuedAt: auth.issuedAt, answers: answer.answers, grant: answer.grant };
  let message: string;
  try {
    message = passkeyMessage(fields, { toolName: pending.toolName, input: pending.input, folder });
  } catch (err) {
    return (err as Error).message;
  }
  const { device, credId, authenticatorData, clientDataJSON, signature } = auth;
  const r = await deps.verify({ device, credId, message, authenticatorData, clientDataJSON, signature });
  return r.ok ? null : (r.reason ?? "That passkey approval doesn't check out.");
}
