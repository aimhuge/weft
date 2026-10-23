import { endSession, isBusy, sendMessage, setModel } from "./runner";
import { getCard, getThread, updateCard } from "./store";
import type { Backend, Card } from "./types";
import { effortFor, modelOn } from "./new-thread";

// Re-sends the card's last user message on a different model, in a fresh session of the
// same CLI (lib/runner.ts setModel). Used by the "first message failed" banner: the
// card's model is what's exhausted, so rerun on the user's configured backup model.
// The model goes through modelOn: a puku card picking claude-fable-5-1 lands on puku's
// own default, because that model id would be served by Claude (modelOn normalizes).
export async function rerunOnModel(cardId: string, model: string) {
  const card = getCard(cardId);
  if (!card) throw new Error("No such card.");
  if (isBusy(cardId)) throw new Error("Stop the thread before rerunning it.");
  await endSession(cardId);
  // Normalize the requested model the same way switchBackend does, so a card on puku
  // asking for a Claude id doesn't quietly pick a different model than the picker shows.
  const normalized = modelOn(card.backend, model) ?? model;
  if (normalized !== card.model) {
    // Different model: clear the session so the new model takes effect on the next send.
    updateCard(cardId, { model: normalized, sessionId: undefined, error: undefined, rateLimitHit: false });
  } else {
    // Same model: leave the session id alone (it may already be empty) but still clear
    // the error and rate-limit flag — that's the point of the rerun.
    updateCard(cardId, { error: undefined, rateLimitHit: false });
  }
  const last = [...getThread(cardId)].reverse().find((item) => item.kind === "user");
  if (last?.kind === "user") sendMessage(cardId, last.text, { echo: false });
}

// Flips a card to another CLI (right-click menu, rate-limit banner). replay re-sends the
// last user message. Puku-cli doesn't support YOLO, so a switch to puku downgrades bypassPermissions;
// it also doesn't take xhigh effort, so a switch normalizes that through effortFor(). The model goes
// with it: `model` when the picker named one, else the card's own if the new CLI serves it (modelOn).
export async function switchBackend(cardId: string, backend: Backend, { replay = false, model }: { replay?: boolean; model?: string } = {}) {
  const card = getCard(cardId);
  if (!card) throw new Error("No such card.");
  if (card.backend === backend) {
    // Same CLI, another of its models: no new session needed.
    if (model && model !== card.model) setModel(cardId, model);
    return;
  }
  if (isBusy(cardId)) throw new Error("Stop the thread before switching its CLI.");
  await endSession(cardId);
  updateCard(cardId, switchPatch(card, backend, model));
  if (replay) {
    const last = [...getThread(cardId)].reverse().find((item) => item.kind === "user");
    if (last?.kind === "user") sendMessage(cardId, last.text, { echo: false });
  }
}

// What a card changes on its way to another CLI: a fresh session, and the mode, effort and model it can take.
function switchPatch(card: Card, backend: Backend, model: string | undefined): Partial<Card> {
  // The stats go too, but for the folder's branch and changed lines: the model, context, cache, tokens and
  // plan limits were the old CLI's session's, and the status strip would show them as the new one's.
  const { branch, added, removed } = card.stats ?? {};
  const patch: Partial<Card> = { backend, sessionId: undefined, rateLimitHit: false, stats: { branch, added, removed } };
  if (backend === "puku" && card.permissionMode === "bypassPermissions") patch.permissionMode = "auto";
  const normalized = effortFor(backend, card.effort);
  if (normalized !== card.effort) patch.effort = normalized;
  const nextModel = modelOn(backend, model ?? card.model);
  if (nextModel !== card.model) patch.model = nextModel;
  return patch;
}
