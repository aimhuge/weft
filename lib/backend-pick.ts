import { isLive } from "./format";
import { modelOn, resolveModel } from "./new-thread";
import type { Backend, Card } from "./types";

// What the thread header's model picker (components/BackendPicker.tsx) draws on the card the moment you pick, before
// the server's switch comes back (lib/backend-switch.ts switchBackend): the CLI the model belongs to and the model
// itself. A live thread can't change CLI, so that pick is refused here at once, with the server's own words.
//
// The CLI comes from resolveModel — the same rule the server's switchBackend uses — so the card
// can't flash one CLI and land on another. A model no CLI serves keeps the CLI the user picked.
export function backendPick(card: Card, next: Backend, model: string): { patch: Partial<Card> } | { refused: string } {
  const backend = resolveModel(model)?.backend ?? next;
  if (backend !== card.backend && isLive(card)) return { refused: "Stop the thread before switching its CLI." };
  return { patch: { backend, model: modelOn(backend, model) } };
}
