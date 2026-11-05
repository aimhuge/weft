// Who took which card over (cloud_card_takeovers, lib/team-takeover.ts), read back for the boards: a teammate's card
// on yours carries the mark (lib/team-board.ts), and your own card a teammate took gets noted on this Mac, once, so its
// tile says who has it now. A database without the table yet (the app ships ahead of its migration) has no marks.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCard, updateCard } from "./store";

export interface TakeoverRow {
  org_id: string;
  card_id: string;
  by_user: string;
  at: string;
}

const missingTable = (error: { code?: string }) => error.code === "42P01" || error.code === "PGRST205";

// The most takeovers one read takes per workspace, newest kept: few cards are ever taken over.
export const TAKEOVER_LIMIT = 1000;

// The newest takeover of each card in one workspace, read whole rather than by the cards in hand: a board's read can
// hold hundreds of ids, too many for one request's URL.
export async function takeoversOf(client: SupabaseClient, org: string): Promise<Map<string, TakeoverRow>> {
  const { data, error } = await client.from("cloud_card_takeovers").select("org_id, card_id, by_user, at").eq("org_id", org).order("at", { ascending: false }).limit(TAKEOVER_LIMIT);
  if (error && !missingTable(error)) console.warn(`[team-takeover] couldn't read takeovers: ${error.message}`);
  return newestPerCard(data ?? []);
}

// Rows newest first → each card's newest.
function newestPerCard(rows: TakeoverRow[]): Map<string, TakeoverRow> {
  const out = new Map<string, TakeoverRow>();
  for (const row of rows) if (!out.has(row.card_id)) out.set(row.card_id, row);
  return out;
}

// Your cards in these workspaces that a teammate took over, newest takeover per card.
export async function takeoversFrom(client: SupabaseClient, uid: string, orgs: string[]): Promise<TakeoverRow[]> {
  if (!orgs.length) return [];
  const { data, error } = await client.from("cloud_card_takeovers").select("org_id, card_id, by_user, at").eq("owner_user", uid).in("org_id", orgs).order("at", { ascending: false }).limit(TAKEOVER_LIMIT);
  if (error && !missingTable(error)) console.warn(`[team-takeover] couldn't read takeovers of your cards: ${error.message}`);
  return [...newestPerCard(data ?? []).values()];
}

// Marks each of your cards a teammate took over with who and when, the first time this Mac hears of it.
export function noteTakeovers(rows: TakeoverRow[], name: (user: string) => string): void {
  for (const row of rows) {
    const card = getCard(row.card_id);
    if (!card || card.takenOverBy?.at === row.at) continue;
    updateCard(row.card_id, { takenOverBy: { name: name(row.by_user), at: row.at } });
  }
}
