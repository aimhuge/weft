// card.create: a new thread on the host, as the New thread dialog makes one (lib/new-card.ts), with the id the board
// picked so it can draw and follow the card it asked for. `start: false` leaves it in Backlog. A worker runs it from a
// `host` command (lib/host/dispatch.ts), its folder the row's own checkout, never one the args name (remoteRefusal).
import { createCardFromBody, startCard } from "../new-card";
import { getCard } from "../store";
import { cardIds } from "./card-ids";
import type { Card } from "../types";

export type CreateArgs = { id: string; start?: boolean } & Record<string, unknown>;
export type Created = { card: Card; start: { started: boolean; at?: number } };

// A uuid, or anything of its shape the board's randomUUID could give: never a path or a name.
const CARD_ID = /^[0-9a-zA-Z-]{8,64}$/;

export async function createCardVerb({ id, start, ...body }: CreateArgs, ids = cardIds()): Promise<Created> {
  if (!CARD_ID.test(id)) throw new Error("That new card's id isn't one.");
  if (getCard(id)) throw new Error("That card is already on this host.");
  // An id this host has had before, even if its card is gone: never again (lib/host-api/card-ids.ts).
  if (ids.used(id)) throw new Error("That card id was used on this host before.");
  ids.remember(id);
  const card = createCardFromBody(body, id);
  return { card, start: start === false ? { started: false } : await Promise.resolve(startCard(card)) };
}
