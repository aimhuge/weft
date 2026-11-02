// Your drag of a card to another column, the card.update step that runs the column's automations.
import { firstMessage, messagesForMove, doneOverrides } from "@/lib/automations";
import { archiveWhenIdle, isBusy, queueMessages, sendMessage } from "@/lib/runner";
import { updateCard } from "@/lib/store";
import { COLUMNS, type Card, type Column } from "@/lib/types";

// Running and Needs you follow the thread's live state, so they can't be set by hand.
const MANUAL: Column[] = ["backlog", "review", "done"];

// Your drag to another column (Running only from Backlog; Needs you never by hand).
export function moveCard(card: Card, column: Column) {
  if (!COLUMNS.some((c) => c.id === column)) throw new Error("Unknown column.");
  if (card.role === "copilot") throw new Error("The copilot isn't on the board.");
  // A turn waiting on you can be parked in Backlog, Review or Done; answering it later runs it on.
  const waiting = Boolean(card.pending) && MANUAL.includes(column);
  if (isBusy(card.id) && !waiting) throw new Error("Stop the thread before moving it.");
  if (column === "running") {
    if (card.column !== "backlog") throw new Error("Reply in the thread to run it again.");
    sendMessage(card.id, firstMessage(card));
  } else if (MANUAL.includes(column)) {
    updateCard(card.id, { column });
    // /weft:done can run on a different model / effort than the card's own (lib/automations doneOverrides).
    // Snapshot the card's picks before queueing the move's messages, so the /weft:done turn uses the
    // override and any later turn on the card goes back to the originals (lib/runner restoreDoneOverride).
    if (column === "done") applyDoneOverride(card);
    // Your own move runs that column's automations (Settings), such as weft:done for Done.
    queueMessages(card.id, messagesForMove(card, column));
    // Done files the card away once its automations (weft:done) have run.
    if (column === "done") archiveWhenIdle(card.id);
    else updateCard(card.id, { archived: false });
  } else {
    throw new Error("Cards move to Needs you on their own.");
  }
}

// Snapshots the card's model and effort onto preDoneModel / preDoneEffort, then sets them to the
// override Settings chose for /weft:done. A no-op when the setting is empty or the card isn't Claude.
// The CLI moves too when the backup model lives on another one: an exhausted model hands the
// wrap-up to the backup rather than make it wait for a reset.
function applyDoneOverride(card: Card) {
  const overrides = doneOverrides(card);
  if (!overrides.model && !overrides.effort && !overrides.backend) return;
  updateCard(card.id, {
    preDoneModel: card.model,
    preDoneEffort: card.effort,
    ...(overrides.backend ? { preDoneBackend: card.backend } : {}),
    ...(overrides.model ? { model: overrides.model } : {}),
    ...(overrides.effort ? { effort: overrides.effort } : {}),
    ...(overrides.backend ? { backend: overrides.backend, sessionId: undefined } : {}),
  });
}
