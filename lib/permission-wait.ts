import path from "node:path";
import { editedPath, isBusy } from "./overlap";
import { pendingView, settle } from "./runner-pending";
import { safeUpdate, sessions, type Pending } from "./runner-state";
import { getCard, updateCard } from "./store";
import { addClaims, claimKey, splitClaim, withoutYield } from "./claims";
import { canSteer, steer } from "./runner-steer";
import type { PromptReason } from "./types";
import { waitTargets, wouldGridlock } from "./wait-chain";

// Wait on a symbol-claim prompt (lib/claims.ts): the edit stays held, the card goes back to running, and
// Weft watches the card holding the code. Once that card lets go (it's no longer busy, or its claim
// dropped because its change was committed), the held edit is answered for the thread: re-read the
// file and redo the edit on top of the other card's change, since what it planned to replace may be gone.
// Go ahead and Deny still answer it while it waits.
//
// A clash waits by itself (lib/runner-ask.ts askUser): the card never parks in Needs you for a claim,
// only for a prompt that really needs the user. The buttons stay on the card and in the thread.
//
// A wait never closes a loop (lib/wait-chain.ts): two cards waiting on each other is gridlock, and no
// button can break it, so a wait that would close one is refused and the card goes ahead instead.

// The card holding the code a request waits on.
export type Holder = NonNullable<PromptReason["holder"]>;

export const WAIT_POLL_MS = 3000;

let timer: ReturnType<typeof setInterval> | undefined;

// Why the holder no longer holds the code, or undefined while it still does.
export function releasedBecause(holder: NonNullable<NonNullable<Pending["why"]>["holder"]>) {
  const card = getCard(holder.id);
  if (!card || card.archived) return `‘${holder.title}’ is gone`;
  if (!isBusy(card)) return `‘${holder.title}’ finished`;
  if (!card.claims?.includes(holder.claim)) return `‘${holder.title}’ committed its change`;
  return undefined;
}

// What the thread is told when its wait ends.
export function waitOverMessage(reason: string, p: Pending) {
  const given = editedPath(p.toolName, p.input);
  const file = given ? path.basename(given) : "the file";
  return `You were held while another card edited the same code; the user chose to wait. ${reason}, so ${file} may have changed. Re-read ${file} and redo this edit on top of its change.`;
}

// Answers every waiting request whose holder let go; stops the watch when none are left.
export function checkWaits() {
  let left = 0;
  for (const [cardId, session] of sessions) {
    for (const p of [...session.pending]) {
      if (!p.waiting || !p.why?.holder) continue;
      const reason = releasedBecause(p.why.holder);
      if (reason) settle(cardId, false, undefined, p.id, undefined, waitOverMessage(reason, p));
      else left++;
    }
  }
  if (!left && timer) {
    clearInterval(timer);
    timer = undefined;
  }
}

// Starts the watch that answers held requests once their holder lets go.
export function watchHolds() {
  timer ??= setInterval(checkWaits, WAIT_POLL_MS);
  checkWaits();
}

// The user chose Wait on this request.
export function waitPermission(cardId: string, pendingId: string) {
  const session = sessions.get(cardId);
  const p = session?.pending.find((x) => x.id === pendingId);
  if (!session || !p) throw new Error("That request isn't waiting anymore.");
  if (!p.why?.holder) throw new Error("Only an edit another card is holding can wait.");
  // Only the request the card is showing changes the card; one behind it waits in the queue.
  if (session.pending[0] === p) startWaiting(cardId, p);
  else startQueuedWaiting(cardId, p);
  watchHolds();
}

// A request behind the one the card is showing: it waits too, but the card's own state belongs to the
// request in front, so nothing is written to the card. The gridlock check still applies — a queued
// request can wait on a holder that is waiting on this card, and that is the same deadlock.
function startQueuedWaiting(cardId: string, p: Pending) {
  const holder = p.why?.holder;
  if (!holder) return;
  if (wouldGridlock(liveWaitTargets(), cardId, holder.id)) {
    breakGridlock(cardId, p, holder);
    return;
  }
  p.waiting = true;
}

// Whether this request is waiting on a holder, and the holder it waits on. A request that a gridlock
// broke is no longer waiting: it went ahead instead (lib/permission-wait.ts breakGridlock).
export function waitingOn(cardId: string, pendingId: string): Holder | undefined {
  const p = sessions.get(cardId)?.pending.find((x) => x.id === pendingId);
  if (!p?.waiting || !p.why?.holder) return undefined;
  return p.why.holder;
}

// The wait graph, read from the live sessions: the card each waiting card waits on. The sessions are
// the truth about who is waiting right now (lib/runner-ask.ts marks the request waiting as it asks),
// so a wait is checked against the chain as it stands at that moment. Every waiting request counts —
// a card with two of them holds two edges, and a loop through the second is a loop just as much.
export function liveWaitTargets() {
  const waiting: { id: string; holderId: string }[] = [];
  for (const [cardId, session] of sessions) {
    for (const p of session.pending) {
      if (p.waiting && p.why?.holder) waiting.push({ id: cardId, holderId: p.why.holder.id });
    }
  }
  return waitTargets(waiting);
}

// Puts a request into the waiting state: the card leaves Needs you for Running, and the thread's
// last line says who it waits for. The holder has to be there — a request nothing holds can't wait.
//
// A wait that would close a loop is refused: the card goes ahead instead (breakGridlock), so one of the
// two keeps running and the holder — which is the one waiting on this card — is released.
export function startWaiting(cardId: string, p: Pending) {
  const holder = p.why?.holder;
  if (!holder) return;
  if (wouldGridlock(liveWaitTargets(), cardId, holder.id)) {
    breakGridlock(cardId, p, holder);
    return;
  }
  p.waiting = true;
  safeUpdate(cardId, { column: "running", pending: pendingView(p), lastLine: `Waiting for ‘${holder.title}’` });
}

// The loop-breaking answer: this card takes the file and goes ahead, and the holder leaves the file to
// it. The holder is waiting on this card, so it can only be released once this card lets go — which it
// now does, because it goes ahead and finishes.
export function breakGridlock(cardId: string, p: Pending, holder: Holder) {
  const { file } = splitClaim(holder.claim);
  const card = getCard(cardId);
  if (card) {
    // This card claims the whole file and the holder leaves it to it (the same shape as This first,
    // lib/precedence.ts): the holder's own edits there no longer ask this card.
    updateCard(cardId, { claims: addClaims(card.claims, [claimKey(file)]) ?? card.claims });
    const other = getCard(holder.id);
    if (other) updateCard(other.id, { yields: [...withoutYield(other, cardId, file), { to: cardId, file }] });
    const session = sessions.get(holder.id);
    if (canSteer(session)) steer(holder.id, session, gridlockMessage(card.title, file));
  }
  settle(cardId, true, undefined, p.id);
}

// What the holder is told when a wait would have gridlocked: the other card goes ahead, and the file
// is its to edit now.
export function gridlockMessage(first: string, file: string) {
  const name = path.basename(file);
  return `Weft: card ‘${first}’ is waiting on you for ${name}, and waiting back would leave you both stuck, so ‘${first}’ goes first on ${name}. Leave ${name} to it; if you need to edit ${name} again, the edit waits until it lets go.`;
}
