import { splitClaim } from "./claim-keys";
import { settle } from "./runner-pending";
import { sessions } from "./runner-state";
import { getCard } from "./store";

// Who is blocking whom, and when the block lifts.
//
// A card that went first on a file (lib/precedence.ts) holds the cards whose edits touch that file:
// their edit is held until it lets go. The block lifts as soon as the write lands — the file now has
// the first card's change, so the waiting card can re-read it and redo its edit on top, which is
// exactly what lib/permission-wait.ts tells it to do. Before this, the wait only ended when the
// first card committed or its turn ended, so a card could sit blocked long after the file it was
// waiting on had been written.
//
// The wait itself lives in the sessions (lib/runner-pending.ts), so this only answers the ones whose
// holder has just written the file they were waiting on.

// The waiting requests, by the file they wait on: the holder's card and the request it holds.
function waitsOnFile(file: string) {
  const out: { cardId: string; pendingId: string; holderId: string }[] = [];
  for (const [cardId, session] of sessions) {
    for (const p of session.pending) {
      if (!p.waiting || !p.why?.holder) continue;
      const { file: theirs } = splitClaim(p.why.holder.claim);
      if (theirs === file) out.push({ cardId, pendingId: p.id, holderId: p.why.holder.id });
    }
  }
  return out;
}

// The card wrote this file: release the cards waiting on it for it. The waiting thread is told to
// re-read the file and redo its edit on top of the change that just landed.
export function releaseOnWrite(cardId: string, file: string) {
  for (const w of waitsOnFile(file)) {
    // Only the holder's own waiters go: another card's wait on the same file isn't this write's.
    if (w.holderId !== cardId) continue;
    const p = sessions.get(w.cardId)?.pending.find((x) => x.id === w.pendingId);
    if (!p) continue;
    settle(w.cardId, false, undefined, w.pendingId, undefined, writeMessage(getCard(cardId)?.title ?? "the other card", file));
  }
}

// What the waiting thread is told when the write it was waiting for lands.
export function writeMessage(holderTitle: string, file: string) {
  const name = file.split("/").pop() ?? file;
  return `You were held while another card edited the same code; the user chose to wait. ‘${holderTitle}’ has now written ${name}, so it has changed. Re-read ${name} and redo this edit on top of its change.`;
}
