import { createHmac } from "node:crypto";
import { shellToken } from "./shell-token";

// Which card a vault request is for, proven rather than claimed (docs/architecture/secrets.md).
//
// Electron main used to take the card id from the request body, so a body that named another
// card's id acted as that card: its grant, its unlocks and its audit lines all hang off that id.
// The server signs the card id with the launch token and main checks the signature before it
// believes it. A request without a valid signature has no card, and main refuses the vault.
//
// The signature covers the route too, so a signature for one route can't be replayed on another.

// The tag the server sends with a card id.
export const CARD_FIELD = "card";
export const SIG_FIELD = "cardSig";

/** The signature for one card and route. The launch token is the shared secret. */
export function signCard(card: string, route: string, secret = shellToken()): string {
  return createHmac("sha256", secret).update(`${route}\n${card}`).digest("hex");
}

/**
 * A card id and its signature, ready to put in a body. Returns nothing when there is no card:
 * a request for Weft itself (the audit outbox, the intake) has no card to be.
 */
export function cardProof(card: string | undefined, route: string): Record<string, string> {
  if (!card) return {};
  return { [CARD_FIELD]: card, [SIG_FIELD]: signCard(card, route) };
}
