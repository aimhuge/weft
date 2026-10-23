import { isModelLimited, modelLimit } from "./model-limit";
import { backendFor, modelOn, NO_MODEL } from "./new-thread";
import { backupModel } from "./settings";
import type { Backend } from "./types";

// The rule the user asked for: when a thread is on a model that has hit its limit, it moves to the
// backup model. It applies to every kind of thread — a new one, a running one, a subagent, the
// /weft:done wrap-up, the Review all card — because they all pick a model the same way.
//
// The backup model is the user's pick (Settings → Models → Backup model). It may live on another
// CLI: a Claude card whose Opus is exhausted moves to a Puku model, and the card's CLI moves with
// it, so the thread keeps running instead of waiting for a reset hours away.
//
// When no backup model is set, the thread stays where it is: the card is parked in Needs you with
// its error, and the user picks a model by hand. Weft never guesses a model the user didn't pick.

export interface Fallback {
  // The model the thread should run on now, or undefined to leave it alone.
  model?: string;
  // The CLI it should run on, when it has to change (a backup on another CLI).
  backend?: Backend;
  // The model it was on, for the card's line.
  from?: string;
}

// The model the thread should run on instead of `model`, when `model` is exhausted.
// Returns undefined when there's nothing to do: no model, the model is fine, or no backup model
// is set to fall back to.
export function fallbackFor(model: string | undefined, now = Date.now()): Fallback | undefined {
  if (!model) return undefined;
  if (!isModelLimited(model, now)) return undefined;
  const backup = backupModel();
  if (!backup) return undefined;
  // The backup model has to be one a CLI serves, and it can't be the model that's exhausted.
  const backend = backendFor(backup);
  if (!backend || backup === model) return undefined;
  return { model: backup, backend, from: model };
}

// The model a thread should actually run on: its own, unless it's exhausted and there's a backup
// to move to. The CLI moves with the model when it changes.
export function modelWithFallback(
  backend: Backend,
  model: string | undefined,
  now = Date.now(),
): { backend: Backend; model?: string; switched: boolean } {
  const fallback = fallbackFor(model, now);
  if (!fallback?.model) return { backend, model: modelOn(backend, model), switched: false };
  return { backend: fallback.backend ?? backend, model: fallback.model, switched: true };
}

// The line a card shows when it moved: "Opus 5.5 hit its limit — moved to Sonnet 5.5".
export function fallbackLine(from: string, to: string): string {
  return `${from} hit its limit — moved to ${to}`;
}

// How long an exhausted model stays exhausted, for the picker to say so ("until 2:30am").
// lib/limit-reset.ts has the same line for every place that asks "when does this free up?"; this
// one is kept here so a caller that only wants the fallback doesn't need the plan log too.
export function limitNote(model: string | undefined, now = Date.now()): string | undefined {
  const limit = modelLimit(model, now);
  if (!limit) return undefined;
  return `limit until ${new Date(limit.resetsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

// The model a card should start on: the one that was picked, unless it's exhausted and a backup
// takes over. Used wherever a model is chosen — the New thread dialog, the copilot, the Done
// wrap-up, the Review all card — so they all behave the same way.
export function resolveWithFallback(model: string | undefined, now = Date.now()): string {
  const fallback = fallbackFor(model, now);
  return fallback?.model ?? model ?? NO_MODEL;
}
