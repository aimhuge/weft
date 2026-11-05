import { subscribe } from "./bus";
import { shell } from "./browser-shell";
import { cardProof } from "./card-token";
import { globalSingleton } from "./global-singleton";
import type { BoardEvent } from "./types";

// A vault grant for the thread (mcp__secrets__request_access with span "thread", electron/vault-grants.cjs) lasts
// until its card's work ends: when the card reaches Done, is archived or is deleted, main is told to revoke the card's grants.
// Main caps such a grant at 12 hours anyway, so a server restart that drops this watch can't leave one open for good.

const watching = globalSingleton("__weftVaultGrantDone", () => new Map<string, () => void>());

// Whether this event says the card's work has ended: Done, archived or deleted.
export function workEnded(event: BoardEvent, card: string): boolean {
  if (event.type === "card_deleted") return event.id === card;
  if (event.type !== "card" || event.card.id !== card) return false;
  return event.card.column === "done" || Boolean(event.card.archived);
}

/** Revokes the card's vault grants once it reaches Done. One watch per card; a second call is a no-op. */
export function endGrantAtDone(card: string | undefined, revoke = (id: string) => shell("/secrets/revoke-card", cardProof(id, "/secrets/revoke-card"))) {
  if (!card || watching.has(card)) return;
  const stop = subscribe((event) => {
    if (!workEnded(event, card)) return;
    stop();
    watching.delete(card);
    void revoke(card).catch(() => null);
  });
  watching.set(card, stop);
}
