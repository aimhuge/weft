// What a Weft Worker does about the turns its last daemon died in (docs/architecture/weft-worker.md). lib/store.ts has
// already moved those cards to Review as it loaded, as on a Mac, but it did so without a bus event, so the cloud still
// shows them Running and offers Allow on requests that are gone. This finds them and tidies their threads; the daemon
// publishes them, then lib/resume.ts carries on the ones it can.
import { CLOSED_LINE } from "./card-resume";
import type { Card, ThreadItem } from "./types";

// Shown on a card that stays stopped: lib/resume.ts's message says why on the ones it carries on.
export const STOPPED_NOTE = "The worker restarted during this turn, so it stopped. Send a message to pick it up again.";

export interface RecoverStore {
  listCards(): Card[];
  getThread(id: string): ThreadItem[];
  replaceThreadItem(cardId: string, index: number, item: ThreadItem): void;
  appendThread(cardId: string, item: ThreadItem): number;
}

// `cut`: never reported as stopped, so the whole thread goes up, for whatever the dead daemon's queue lost.
// `stopped`: only the card row. A card keeps CLOSED_LINE until its next turn, so this repeats on every restart, and
// that's what repairs a row a failed publish left wrong.
export interface Recovered {
  cut: string[];
  stopped: string[];
}

// lib/resume.ts's own test, so a card that gets its message doesn't get the note as well.
const willResume = (card: Card) => Boolean(card.interrupted && card.sessionId && !card.archived);

// No session has survived, so a request still undecided can't be answered any more. Its turn asks again if it needs to.
function closePermissions(store: RecoverStore, cardId: string) {
  store.getThread(cardId).forEach((item, index) => {
    if (item.kind === "permission" && !item.decision) store.replaceThreadItem(cardId, index, { ...item, decision: "deny" });
  });
}

function noteStopped(store: RecoverStore, card: Card) {
  const last = store.getThread(card.id).at(-1);
  if (last?.kind === "notification" && last.summary === STOPPED_NOTE) return;
  store.appendThread(card.id, { kind: "notification", status: "stopped", summary: STOPPED_NOTE, at: Date.now() });
}

export function recoverCards(store: RecoverStore): Recovered {
  const found: Recovered = { cut: [], stopped: [] };
  for (const card of store.listCards()) {
    if (card.role === "copilot" || !(card.interrupted || card.lastLine === CLOSED_LINE)) continue;
    closePermissions(store, card.id);
    if (!willResume(card)) noteStopped(store, card);
    (card.interrupted ? found.cut : found.stopped).push(card.id);
  }
  return found;
}
