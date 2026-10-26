import { hooks, isBusy } from "./runner-state";
import { getCard, getThread, updateCard } from "./store";
import type { Backend, Card } from "./types";
import { effortFor, modelLabel, modelOn, resolveModel } from "./new-thread";
import { fallbackFor, fallbackLine } from "./model-fallback";
import { repointCard } from "./card-repoint";

// Moves a card off a model that has hit its limit, onto the user's backup model, and replays the
// turn that was cut off there. This is what happens by itself when a thread's model runs out
// (lib/rate-limit.ts records the hit; lib/model-fallback.ts decides where to go): the thread keeps
// working instead of waiting hours for the window to reset.
//
// The backup model may live on another CLI (a Claude card whose Opus is exhausted moves to a Puku
// model), so the CLI moves with it and the card starts a fresh session there — the old session is
// on the exhausted model. Returns what happened, so the caller can put it on the card's line.
//
// Returns undefined when there's nothing to do: the model is fine, or no backup model is set.
export async function switchToBackup(cardId: string): Promise<{ from: string; to: string } | undefined> {
  const card = getCard(cardId);
  if (!card) return undefined;
  const fallback = fallbackFor(card.model);
  if (!fallback?.model || !fallback.from) return undefined;
  const backend = fallback.backend ?? card.backend;
  // A card that's mid-turn can't have its session swapped under it; the turn that hit the limit
  // has already ended by the time we get here, so this is only a guard.
  if (isBusy(cardId)) return undefined;
  await hooks.endSession(cardId);
  const patch = switchPatch(card, backend, fallback.model);
  // The error and the limit flag go: the card is running again, on a model that works.
  updateCard(cardId, { ...patch, error: undefined, rateLimitHit: false, lastLine: fallbackLine(modelLabel(fallback.from), modelLabel(fallback.model)) });
  const last = [...getThread(cardId)].reverse().find((item) => item.kind === "user");
  if (last?.kind === "user") hooks.send(cardId, last.text, { echo: false });
  return { from: fallback.from, to: fallback.model };
}

// Re-sends the card's last user message on a different model, in a fresh session. Used by the
// "first message failed" banner: the card's model is what's exhausted, so rerun on the user's
// configured backup model.
// The backup may live on another CLI, so the card moves to the CLI that serves the model: one
// pick, one thread, and the CLI and the model always agree.
export async function rerunOnModel(cardId: string, model: string) {
  const card = getCard(cardId);
  if (!card) throw new Error("No such card.");
  if (isBusy(cardId)) throw new Error("Stop the thread before rerunning it.");
  await hooks.endSession(cardId);
  const backend = resolveModel(model)?.backend;
  if (backend && backend !== card.backend) {
    // Another CLI's model: the card moves there, in a fresh session on that CLI.
    updateCard(cardId, { backend, model, sessionId: undefined, error: undefined, rateLimitHit: false });
  } else {
    // The model's own CLI, or one it doesn't serve: it drops to that CLI's own choice.
    const normalized = modelOn(card.backend, model);
    if (normalized !== card.model) {
      // Different model: clear the session so the new model takes effect on the next send.
      updateCard(cardId, { model: normalized, sessionId: undefined, error: undefined, rateLimitHit: false });
    } else {
      // Same model: leave the session id alone (it may already be empty) but still clear
      // the error and rate-limit flag — that's the point of the rerun.
      updateCard(cardId, { error: undefined, rateLimitHit: false });
    }
  }
  const last = [...getThread(cardId)].reverse().find((item) => item.kind === "user");
  if (last?.kind === "user") hooks.send(cardId, last.text, { echo: false });
}

// Flips a card to another CLI (right-click menu, rate-limit banner). replay re-sends the
// last user message. Puku-cli doesn't support YOLO, so a switch to puku downgrades bypassPermissions;
// it also doesn't take xhigh effort, so a switch normalizes that through effortFor(). The model goes
// with it: `model` when the picker named one, else the card's own if the new CLI serves it (modelOn).
export async function switchBackend(cardId: string, backend: Backend, { replay = false, model }: { replay?: boolean; model?: string } = {}) {
  const card = getCard(cardId);
  if (!card) throw new Error("No such card.");
  // A model from another CLI moves the card to the CLI that serves it: one pick, one thread, and
  // the CLI and the model always agree. "" is the CLI's own default, which it already is.
  // resolveModel is the one rule for "the CLI that serves a model" — the same one the board predicts
  // with (lib/backend-pick.ts), so the card can't flash one CLI and land on another.
  const target = (model ? resolveModel(model)?.backend : undefined) ?? backend;
  if (card.backend === target) {
    // Same CLI, another of its models: no new session needed.
    if (model !== undefined && model !== card.model) hooks.setModel(cardId, model);
    return;
  }
  // The one re-point rule (lib/card-repoint.ts): refuse while a turn is running, end the session,
  // then patch the card — the patch last, so the session's wind-down can't write its session id
  // and stats back over the new CLI's.
  await repointCard(card, switchPatch(card, target, model), "Stop the thread before switching its CLI.", {
    isBusy,
    endSession: hooks.endSession,
  });
  if (replay) {
    const last = [...getThread(cardId)].reverse().find((item) => item.kind === "user");
    if (last?.kind === "user") hooks.send(cardId, last.text, { echo: false });
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
