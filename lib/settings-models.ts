import { backendFor, EFFORTS } from "./new-thread";
import { isEmpty, readSetting, writeSetting } from "./settings-store";
import type { Effort } from "./types";

// The model picks in Settings → Models: what /weft:done runs on, what the copilot starts on, what
// "Review all" runs on and the backup model the failed-first-message banner reruns on. They live
// together because they are one rule — a model a CLI serves, or "" for "no override" — and one
// place a new model pick is added.

// Any model a CLI serves, or "" for the default. One rule for all of them: a model id no CLI
// serves is a stale hand-edit and reads as the default, not as a model the board can't run.
function isAnyModel(value: unknown): value is string {
  return value === "" || (typeof value === "string" && backendFor(value) !== undefined);
}

// Any model either CLI serves; it applies to cards on that CLI (lib/automations.ts doneOverrides).
// "" means use the card's own model.
export function doneModel(): string {
  return readSetting("doneModel", isAnyModel, "");
}

// Empty string restores the default (no override).
export function setDoneModel(model: string) {
  writeSetting("doneModel", model, isEmpty);
}

// The stored value is an Effort id or absent (setDoneEffort stores "" as unset), so this only has to
// recognise a real id; "" is the read-time fallback, not something settings.json can hold.
function isDoneEffort(value: unknown): value is Effort {
  return EFFORTS.some((e) => e.id === value);
}

// "" is the default ("use the card's own effort").
export function doneEffort(): Effort | "" {
  return readSetting("doneEffort", isDoneEffort, "");
}

export function setDoneEffort(effort: Effort | "") {
  writeSetting("doneEffort", effort, isEmpty);
}

// The copilot is one long-lived thread (lib/copilot.ts), so its model is any model a CLI serves;
// picking one moves the copilot's CLI to the one that serves it. "" means "use the user's
// last-picked model" (lib/new-thread.ts modelFor).
export function copilotModel(): string {
  return readSetting("copilotModel", isAnyModel, "");
}

export function setCopilotModel(model: string) {
  writeSetting("copilotModel", model, isEmpty);
}

// "Review all" starts a card, so its model is any model a CLI serves. "" means the CLI's default.
export function reviewAllModel(): string {
  return readSetting("reviewAllModel", isAnyModel, "");
}

export function setReviewAllModel(model: string) {
  writeSetting("reviewAllModel", model, isEmpty);
}

// The first-message-failed banner's backup model: any model any installed CLI serves, or "" for "off".
// The rerun normalizes through lib/new-thread.ts modelOn, so a Claude id on a Puku card lands on Puku's
// default — that's a banner, not a model picker, and the normalization keeps the label honest.
export function backupModel(): string {
  return readSetting("backupModel", isAnyModel, "");
}

// "" is the default ("no backup set"), so an unset value reads as off.
export function setBackupModel(model: string) {
  writeSetting("backupModel", model, isEmpty);
}
