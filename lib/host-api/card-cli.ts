// The card's CLI and model: switch to another CLI (or model on its own), or rerun the last message on a backup model.
import { ALL_MODEL_IDS, BACKEND_IDS, MODELS, NO_MODEL, backendFor } from "@/lib/new-thread";
import { rerunOnModel, switchBackend } from "@/lib/runner";
import { getCard } from "@/lib/store";
import type { Backend, Card } from "@/lib/types";
import { requireCard } from "./types";

type CardReply = { card: Card | undefined };

// Every CLI a card may be switched to. Shared (lib/new-thread.ts), so a CLI added there can be
// switched to here too — a switch to a CLI this list didn't know was refused.
const BACKENDS: Backend[] = BACKEND_IDS;

export type SwitchArgs = { id: string; backend: unknown; model?: unknown; replay?: unknown };

// One-click "switch this card's CLI" — used by the right-click menu and the rate-limit banner.
// replay=true re-sends the last user message, which is what the rate-limit escape hatch wants.
// model (the thread header's picker) is one of that CLI's MODELS; on the card's own CLI it only
// changes the model. The list of models is the shared one (lib/new-thread.ts), so a CLI added
// there brings its models with it.
export async function switchBackendVerb({ id, backend, model, replay }: SwitchArgs): Promise<CardReply> {
  requireCard(id);
  if (typeof backend !== "string" || !BACKENDS.includes(backend as Backend)) {
    throw new Error(`backend must be one of ${BACKENDS.join(", ")}.`);
  }
  // "" is the no-model choice: "let the CLI decide", which is what the Default model row picks.
  // Any other model has to be one this CLI serves — the picker sends a model's own CLI with it,
  // so a model from another CLI is a mismatch worth refusing.
  if (model !== undefined && (typeof model !== "string" || (model !== NO_MODEL && !MODELS[backend as Backend].some((m) => m.id === model)))) {
    throw new Error(`${typeof model === "string" ? model : "That"} isn't a ${backend} model.`);
  }
  await switchBackend(id, backend as Backend, { replay: replay === true, model });
  return { card: getCard(id) };
}

// One-click "rerun the last user message on a different model" — used by the first-message-failed
// banner in the open thread. The card's own model is what's exhausted (a rate limit or any other
// turn failure), so we start a fresh session of the same CLI on the user's chosen backup model and
// re-send the last user message. modelOn inside rerunOnModel normalizes the model to one the card's
// CLI actually serves, so a Puku card asking for claude-fable-5-1 lands on Puku's default.
export async function rerunModelVerb({ id, model }: { id: string; model: unknown }): Promise<CardReply> {
  requireCard(id);
  if (typeof model !== "string" || !model) {
    throw new Error("model must be a non-empty string.");
  }
  const backend = backendFor(model);
  // backendFor returns undefined for codex's default ("codex-default") because MODELS.codex
  // only lists that one model and the picker recognizes it as a token, not as a CLI lookup.
  // Any id in MODELS, regardless of CLI, is a valid backup.
  const inAnyCli = ALL_MODEL_IDS.has(model);
  if (!backend && !inAnyCli) {
    throw new Error(`${model} isn't a model any installed CLI serves.`);
  }
  await rerunOnModel(id, model);
  return { card: getCard(id) };
}
