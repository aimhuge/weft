// What a board read does besides drawing your teammates' cards (lib/team-board.ts), all about cards changing hands: your
// cards a teammate took over get marked (lib/team-takeover-marks.ts), a teammate's ask for one of yours goes on it, your
// own asks show on their cards, and one of yours that's been pushed becomes your card (lib/handover.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import { continueHandovers, handoversFor, noteAsks, type HandoverRow } from "./handover";
import { listCards } from "./store";
import { noteTakeovers, takeoversFrom, type TakeoverRow } from "./team-takeover-marks";
import type { HandoverState } from "./types";

export interface Side {
  // Your cards a teammate took over.
  taken: TakeoverRow[];
  // Teammates' asks for your cards, waiting for an answer.
  asks: HandoverRow[];
  // Your own asks, newest first.
  mine: HandoverRow[];
}

export const NO_SIDE: Side = { taken: [], asks: [], mine: [] };

export async function readSide(client: SupabaseClient, uid: string, orgs: string[], now = Date.now()): Promise<Side> {
  const [taken, asks, mine] = await Promise.all([takeoversFrom(client, uid, orgs), handoversFor(client, "owner", uid, orgs, now), handoversFor(client, "asker", uid, orgs, now)]);
  return { taken, asks, mine };
}

// Whose names the side needs drawn.
export const sideUsers = (side: Side) => [...side.taken.map((t) => t.by_user), ...side.asks.map((a) => a.by_user)];

// Puts what the side read onto this Mac's cards, and starts the cards your pushed asks became (in the background: a
// takeover asks Haiku for a summary, and the board's read shouldn't wait on it).
export function applySide(side: Side, orgs: string[], name: (user: string) => string, client: SupabaseClient, cont = continueHandovers): void {
  noteTakeovers(side.taken, name);
  noteAsks(side.asks, orgs, name, listCards);
  void cont(side.mine, client);
}

// Your newest ask per card, as its tile and bar draw it.
export function handoverStates(mine: HandoverRow[]): Map<string, HandoverState> {
  const out = new Map<string, HandoverState>();
  for (const row of mine) {
    if (out.has(row.card_id)) continue;
    out.set(row.card_id, { id: row.id, status: row.status, ...(row.branch ? { branch: row.branch } : {}), ...(row.note ? { note: row.note } : {}) });
  }
  return out;
}
