import path from "node:path";
import { editedPath, isBusy } from "./overlap";
import { pendingView, settle } from "./runner-pending";
import { safeUpdate, sessions, type Pending } from "./runner-state";
import { getCard } from "./store";

// Wait on a symbol-claim prompt (lib/claims.ts): the edit stays held, the card goes back to running, and
// Weft watches the card holding the code. Once that card lets go (it's no longer busy, or its claim
// dropped because its change was committed), the held edit is answered for the thread: re-read the
// file and redo the edit on top of the other card's change, since what it planned to replace may be gone.
// Go ahead and Deny still answer it while it waits.
//
// A clash waits by itself (lib/runner-ask.ts askUser): the card never parks in Needs you for a claim,
// only for a prompt that really needs the user. The buttons stay on the card and in the thread.

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
  else p.waiting = true;
  watchHolds();
}

// Puts a request into the waiting state: the card leaves Needs you for Running, and the thread's
// last line says who it waits for. The holder has to be there — a request nothing holds can't wait.
export function startWaiting(cardId: string, p: Pending) {
  const holder = p.why?.holder;
  if (!holder) return;
  p.waiting = true;
  safeUpdate(cardId, { column: "running", pending: pendingView(p), lastLine: `Waiting for ‘${holder.title}’` });
}
