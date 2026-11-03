// card.create: a new thread on the host, as the New thread dialog makes one (lib/new-card.ts), with the id the board
// picked so it can draw and follow the card it asked for. `start: false` leaves it in Backlog. A worker runs it from a
// `host` command (lib/host/dispatch.ts), its folder the row's own checkout, never one the args name (remoteRefusal).
//
// The Mac's own POST /api/cards runs it too, as a local caller (HostCtx): its card takes a fresh id when the id is "",
// and a project switched to "Run on Worker" hands the first message to your worker (lib/worker-handoff.ts) rather than
// start it here. Only a local caller hands off, so a worker never sends a card on to another.
import { createCardFromBody, startCard } from "../new-card";
import { deleteCard, getCard } from "../store";
import { cardIds } from "./card-ids";
import type { HostCtx } from "./types";
import type { Card } from "../types";

// id "" leaves the id to this host, for a local caller only.
export type CreateArgs = { id: string; start?: boolean } & Record<string, unknown>;
// `worker`: the worker a hand-off sent the first message to.
export type Created = { card: Card; start: { started: boolean; at?: number; worker?: string } };

// A uuid, or anything of its shape the board's randomUUID could give: never a path or a name.
const CARD_ID = /^[0-9a-zA-Z-]{8,64}$/;

// An id this host has had before, even if its card is gone: never again (lib/host-api/card-ids.ts).
function claimId(id: unknown): string {
  if (typeof id !== "string" || !CARD_ID.test(id)) throw new Error("That new card's id isn't one.");
  if (getCard(id)) throw new Error("That card is already on this host.");
  const ids = cardIds();
  if (ids.used(id)) throw new Error("That card id was used on this host before.");
  ids.remember(id);
  return id;
}

// A failed hand-off drops the card rather than run it here behind your back.
async function begin(card: Card, local: boolean): Promise<Created["start"]> {
  if (!local) return startCard(card);
  const { handOffToWorker, runsOnWorker } = await import("../worker-handoff");
  if (!runsOnWorker(card.cwd)) return startCard(card);
  try {
    return await handOffToWorker(card);
  } catch (err) {
    deleteCard(card.id);
    throw err;
  }
}

export async function createCardVerb({ id, start, ...body }: CreateArgs, ctx: HostCtx = {}): Promise<Created> {
  const local = ctx.local === true;
  // A local caller may leave the id to this host; anyone else names the board's, checked and never reused.
  const card = local && id === "" ? createCardFromBody(body) : createCardFromBody(body, claimId(id));
  // A card whose model or CLI is at its limit waits for the window instead of failing its first turn (lib/start-gate.ts);
  // the answer says when its first message goes out.
  const started = start === false ? { started: false } : await begin(card, local);
  return { card: getCard(card.id) ?? card, start: started };
}
