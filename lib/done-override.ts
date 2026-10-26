import { getCard, updateCard } from "./store";

// Restores the card's model/effort if a Done move patched them for the /weft:done turn (app/api/cards/[id]
// moveCard applies the override from lib/automations doneOverrides). The card stores the originals as
// preDoneModel / preDoneEffort; clearing them here returns the card to its real picks. A no-op when the
// turn wasn't started by a Done move (e.g. the user typed /weft:done themselves).
export function restoreDoneOverride(cardId: string) {
  const card = getCard(cardId);
  if (!card) return;
  if (card.preDoneModel === undefined && card.preDoneEffort === undefined && card.preDoneBackend === undefined) return;
  const patch: {
    preDoneModel: undefined;
    preDoneEffort: undefined;
    preDoneBackend: undefined;
    model?: string;
    effort?: typeof card.effort;
    backend?: typeof card.backend;
  } = {
    preDoneModel: undefined,
    preDoneEffort: undefined,
    preDoneBackend: undefined,
  };
  if (card.preDoneModel !== undefined) patch.model = card.preDoneModel;
  if (card.preDoneEffort !== undefined) patch.effort = card.preDoneEffort;
  if (card.preDoneBackend !== undefined) patch.backend = card.preDoneBackend;
  updateCard(cardId, patch);
}
