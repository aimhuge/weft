// What sign.weft.zip/approve does, apart from drawing (docs/architecture/mobile-security.md, "Passkey approvals"). The
// weft.zip board opens it with only a card id and a pending id; this page reads the waiting ask itself, with its own
// Supabase session, builds the message (lib/web-passkey-approval.ts), and once the passkey has signed, inserts the answer
// command itself. Nothing comes from weft.zip but the two ids, so a script there can't choose what is shown or signed.
import type { SupabaseClient } from "@supabase/supabase-js";
import { BIDI, BIDI_REFUSED, canonicalJson, readPasskeyMessage, type PasskeyMessage } from "./approval-passkey";
import { answerCommand, type NewCommand } from "./cloud-commands";
import type { CloudCardRow } from "./cloud-sync-types";
import { phoneOnly, PHONE_ONLY } from "./passkey-phone-only";
import type { PasskeySignature } from "./web-passkey";
import { approvalToSign, passkeyAuth, type ApprovalToSign } from "./web-passkey-approval";

export interface SignAsk {
  row: CloudCardRow;
  approval: ApprovalToSign;
  // The message, read back strictly: what the sheet draws.
  signed: PasskeyMessage;
}

export const NOT_PAIRED = "This browser hasn't paired a passkey with your Mac yet. On your Mac: Settings → Sync → Pair a passkey.";
export const NOT_WAITING = "That request isn't waiting any more.";

// The ids off the page's URL, or null when either is missing.
export function askIds(search: string): { cardId: string; pendingId: string } | null {
  const q = new URLSearchParams(search);
  const cardId = q.get("card") ?? "";
  const pendingId = q.get("pending") ?? "";
  return cardId && pendingId ? { cardId, pendingId } : null;
}

// The ask to sign, or why there is none.
export async function loadAsk(client: SupabaseClient, ids: { cardId: string; pendingId: string }, passkey: { device: string; credId: string } | null, now: number): Promise<SignAsk | string> {
  if (!passkey) return NOT_PAIRED;
  const { data, error } = await client.from("cloud_cards").select("org_id, card_id, owner_device, folder, card, deleted, updated_at").eq("card_id", ids.cardId).overrideTypes<CloudCardRow[]>();
  if (error) return `The request couldn't be read: ${error.message}`;
  const row = data.find((r) => r.card.pending?.id === ids.pendingId);
  const pending = row?.card.pending;
  if (!row || !pending) return NOT_WAITING;
  if (pending.questions?.length || pending.elicitation) return "That's a question, not a permission: answer it on the board.";
  if (phoneOnly(pending)) return PHONE_ONLY;
  if (BIDI.test(canonicalJson(pending.input))) return BIDI_REFUSED;
  try {
    // Never null here (a passkey, an Allow, a permission that isn't phone-only); readPasskeyMessage takes back what it made.
    const approval = approvalToSign(row, { allow: true }, passkey, now) as ApprovalToSign;
    return { row, approval, signed: readPasskeyMessage(approval.message) as PasskeyMessage };
  } catch (err) {
    return (err as Error).message;
  }
}

// Inserts the signed answer for the Mac that runs the card. Null once it's in, or why not.
export async function sendApproval(client: SupabaseClient, ask: SignAsk, sig: PasskeySignature): Promise<string | null> {
  const { row, approval } = ask;
  const target = { orgId: row.org_id, device: row.owner_device, folder: row.folder, cardId: row.card_id };
  const command = answerCommand(target, { pendingId: ask.signed.pending, allow: true, auth: passkeyAuth(approval, sig) }) as NewCommand;
  const { error } = await client.from("cloud_commands").insert(command);
  return error ? `The approval couldn't be sent: ${error.message}` : null;
}
