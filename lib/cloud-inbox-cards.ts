// The Mac's side of the cloud commands that act on a card it runs (lib/cloud-inbox.ts claims and reports them):
// reply, answer, stop and host. All four run lib/host-api's verbs through runVerb, the same handlers as the
// desktop's own routes: reply is card.message, answer card.permission.answer, stop card.stop, and host any verb.
// The old kinds stay on the wire for the phone and weft.zip; what the Mac adds to a verb from the web is here, as
// checks: the card must be in the command's synced folder and not the copilot, an answer passes the approval rule
// (lib/approval-check.ts), and so does every other verb that grants power.
import { approvalProblem } from "./approval-check";
import { shell } from "./browser-shell";
import { answerBody, answerGrant, replyBody, stopBody, type AnswerPayload, type CloudCommandRow } from "./cloud-commands";
import { syncNow } from "./cloud-sync";
import { deviceId } from "./device-id";
import { applyFolderGrant } from "./folder-grant";
import { needsElevation, runVerb, type HostVerb } from "./host-api";
import { hostResult, readHostCommand, remoteRefusal, type HostDone, type HostPayload } from "./host-command";
import { getCard } from "./store";
import { pairingStatus } from "./sync-security";
import type { Card } from "./types";

// Why a verb that grants power can't run from the web: a phone is paired, and only it approves. The phone can't sign
// a host verb yet, so until it can, these stay on the Mac (or Settings → Sync lets the web approve).
export const ELEVATED_REFUSED = "That needs this Mac while a phone is paired: run it here. (Settings → Sync can let the web approve.)";

// The card a command acts on: in the command's folder (so a command can't reach a thread outside a synced folder), and
// not the copilot.
function macCard(cardId: string, folder: string, copilot: string): Card {
  const card = getCard(cardId);
  if (!card || card.cwd !== folder) throw new Error("That thread isn't on this Mac anymore.");
  if (card.role === "copilot") throw new Error(copilot);
  return card;
}

// A reply goes to the card the way the reply box sends one: now, or after the turn that's running (the card shows it
// queued).
export async function replyFromCommand(command: CloudCommandRow): Promise<string> {
  const reply = replyBody(command);
  if (!reply) throw new Error("That reply is empty.");
  const card = macCard(reply.cardId, command.folder, "The copilot can't be answered from the web.");
  await runVerb("card.message", { id: card.id, text: reply.text });
  // The message is in the outbox already; this sends it now rather than on the next tick.
  syncNow();
  return card.id;
}

// An answer goes to the card's pending permission request or question. The answer verb throws when the request isn't
// waiting any more, which the inbox turns into a failed report. It also has to pass the approval rule: a signed answer
// must be a paired phone's (or a paired browser's passkey), and an unsigned Allow on a permission request waits for the phone once one is paired.
export async function answerFromCommand(command: CloudCommandRow): Promise<string> {
  const answer = answerBody(command);
  if (!answer) throw new Error("That answer is empty.");
  const card = macCard(answer.cardId, command.folder, "The copilot can't be answered from the web.");
  const pairing = await pairingStatus();
  const problem = await approvalProblem(command, answer, card.pending, {
    verify: async (body) => (await shell("/pairing/verify", body)) as { ok: boolean; reason?: string },
    approvers: () => Promise.resolve(pairing.approvers),
    webApprovals: pairing.webApprovals,
    now: Date.now(),
    // A browser's passkey: the message is rebuilt from this Mac's own device id and workspace (the inbox has already
    // refused a command whose org isn't the one this Mac syncs to), and main checks it against the pin.
    passkey: {
      self: { orgId: command.org_id, macDevice: deviceId(), folder: card.cwd },
      verify: async (body) => (await shell("/pairing/passkey-verify", body)) as { ok: boolean; reason?: string },
    },
  });
  if (problem) throw new Error(problem);
  // Read before the answer clears the request; written after it, so one that has gone leaves no grant behind.
  const grant = answerGrant(answer, card.pending);
  const { reply } = answer;
  await runVerb("card.permission.answer", { id: card.id, allow: answer.allow, answers: answer.answers, pendingId: answer.pendingId, annotations: reply?.annotations, chat: reply?.chat });
  if (grant) applyFolderGrant(card.id, grant.directory, grant.scope);
  // Settling an answer already updates the card; sync so the web board sees the new state.
  syncNow();
  return card.id;
}

// A stop ends the card's running turn.
export async function stopFromCommand(command: CloudCommandRow): Promise<string> {
  const body = stopBody(command);
  if (!body) throw new Error("That stop is missing the card.");
  const card = macCard(body.cardId, command.folder, "The copilot can't be stopped from the web.");
  await runVerb("card.stop", { id: card.id });
  // stop() ends the turn; sync so the web board sees the card back in needs_you / idle.
  syncNow();
  return card.id;
}

// A host verb's answer is an answer: the same payload the answer kind carries, so it takes the same approval rule and
// a phone's signature (args.auth) over the same fields. It needs the request's pendingId, as the answer kind does.
function asAnswer(command: CloudCommandRow, { args }: HostPayload): CloudCommandRow {
  const { id, pendingId, allow, answers, annotations, chat, auth } = args;
  const payload = { cardId: id, pendingId, allow, answers, reply: { annotations, chat }, auth } as AnswerPayload;
  return { ...command, kind: "answer", payload };
}

// Any other verb that grants power (the shell, Wait, This first, a mode or a read grant) goes through only while the
// web may approve: no phone paired, or Settings → Sync says so.
async function elevatedProblem(verb: HostVerb, args: Record<string, unknown>): Promise<string | null> {
  if (!needsElevation(verb, args as never)) return null;
  const pairing = await pairingStatus();
  return pairing.approvers > 0 && !pairing.webApprovals ? ELEVATED_REFUSED : null;
}

// Any verb in lib/host-api, on a card in a synced folder. The author check (created_by) is the inbox's, as for every
// kind; a host command adds no second one.
export async function hostFromCommand(command: CloudCommandRow): Promise<HostDone> {
  const body = readHostCommand(command);
  if (body.verb === "card.permission.answer") {
    const cardId = await answerFromCommand(asAnswer(command, body));
    return { cardId, result: hostResult(cardId) };
  }
  const card = macCard(body.args.id, command.folder, "The copilot can't be reached from the web.");
  const refused = remoteRefusal(body) ?? (await elevatedProblem(body.verb, body.args));
  if (refused) throw new Error(refused);
  await runVerb(body.verb, { ...body.args, id: card.id });
  syncNow();
  return { cardId: card.id, result: hostResult(card.id) };
}
