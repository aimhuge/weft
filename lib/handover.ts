// Asking a teammate for their card (docs/architecture/cloud-sync.md#asking-for-a-handover), the other way to take one
// over: "Take over now" (lib/team-takeover.ts) starts from what they pushed and works while their Mac is off; "Ask"
// leaves a row in cloud_handovers that their Mac shows on the card. If they say yes, their Mac stops the card, pushes its
// work to a branch (lib/handover-push.ts) and says which; your Mac sees it on its next board read and takes the card over
// from that branch, on its own, so you don't have to be watching. They can say not now, and you can still take it over.
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { touchedFiles } from "./handoff";
import { handoverBranch, pushCardWork } from "./handover-push";
import { stop } from "./runner";
import { getCard, getThread, updateCard } from "./store";
import { takeOverTeamCard } from "./team-takeover";
import type { HandoverStatus } from "./types";

export interface HandoverRow {
  id: string;
  org_id: string;
  card_id: string;
  by_user: string;
  owner_user: string;
  status: HandoverStatus;
  branch: string | null;
  sha: string | null;
  note: string | null;
  created_at: string;
}

// Ask for a teammate's card. Returns the ask's id.
export async function askHandover(org: string, cardId: string, client: SupabaseClient = accountClient()): Promise<{ id: string }> {
  const { data, error } = await client.from("cloud_handovers").insert({ org_id: org, card_id: cardId }).select("id").single<{ id: string }>();
  if (error) throw new Error(error.code === "42P01" || error.code === "PGRST205" ? "Asking isn't set up yet: use Take over now." : `Couldn't ask: ${error.message}`);
  return data;
}

async function setStatus(client: SupabaseClient, id: string, patch: Partial<Pick<HandoverRow, "status" | "branch" | "sha" | "note">>, from?: HandoverStatus): Promise<boolean> {
  let query = client.from("cloud_handovers").update(patch).eq("id", id);
  if (from) query = query.eq("status", from);
  const { data, error } = await query.select("id");
  if (error) throw new Error(`Couldn't answer the ask: ${error.message}`);
  return data.length > 0;
}

// On the owner's Mac: yes pushes the card's work and says where; no says not now. Either way the ask leaves the card.
export async function answerHandover(cardId: string, yes: boolean, client: SupabaseClient = accountClient(), push = pushCardWork): Promise<{ branch?: string }> {
  const card = getCard(cardId);
  const ask = card?.handoverAsk;
  if (!card || !ask) throw new Error("Nobody's asking for that card anymore.");
  updateCard(cardId, { handoverAsk: undefined });
  if (!yes) {
    await setStatus(client, ask.id, { status: "declined" }, "asked");
    return {};
  }
  if (!(await setStatus(client, ask.id, { status: "pushing" }, "asked"))) throw new Error(`${ask.name} isn't asking anymore.`);
  try {
    if (card.column === "running") await stop(cardId);
    const files = touchedFiles(getThread(cardId)).map((f) => f.file);
    const pushed = await push(card.cwd, files, handoverBranch(cardId), `wip: hand "${card.title}" over to ${ask.name}\n\nPushed by Weft for a handover; the files this card changed, on top of HEAD.`);
    await setStatus(client, ask.id, { status: "pushed", branch: pushed.branch, sha: pushed.sha });
    return { branch: pushed.branch };
  } catch (err) {
    const note = err instanceof Error ? err.message : String(err);
    await setStatus(client, ask.id, { status: "failed", note: note.slice(0, 500) }).catch(() => false);
    throw new Error(`Couldn't push this card's work: ${note}`);
  }
}

// On the owner's Mac, every board read: each open ask for one of your cards is on the card (shown with the name of who
// asks), and an ask that's gone (called off, or answered on another Mac of yours) comes off.
export function noteAsks(rows: HandoverRow[], orgs: string[], name: (user: string) => string, cards: () => { id: string; handoverAsk?: { id: string; org: string } }[]): void {
  const open = new Map(rows.filter((r) => r.status === "asked").map((r) => [r.card_id, r]));
  for (const [cardId, row] of open) {
    const card = getCard(cardId);
    if (card && card.handoverAsk?.id !== row.id) updateCard(cardId, { handoverAsk: { id: row.id, org: row.org_id, name: name(row.by_user), at: row.created_at } });
  }
  for (const card of cards()) {
    if (card.handoverAsk && orgs.includes(card.handoverAsk.org) && open.get(card.id)?.id !== card.handoverAsk.id) updateCard(card.id, { handoverAsk: undefined });
  }
}

// On the asker's Mac, every board read: an ask that's been pushed becomes your card, once, from its branch. Marking it
// taken first is the lock (only one read, on one Mac, gets pushed → taken), so a slow takeover isn't started twice; one
// that fails calls the ask off with why, and Take over now is still there.
export async function continueHandovers(rows: HandoverRow[], client: SupabaseClient = accountClient(), take = takeOverTeamCard): Promise<void> {
  for (const row of rows) {
    if (row.status !== "pushed" || !row.branch) continue;
    try {
      if (!(await setStatus(client, row.id, { status: "taken" }, "pushed"))) continue;
      await take(row.org_id, row.card_id, client, undefined, { branch: row.branch, ...(row.sha ? { sha: row.sha } : {}) });
    } catch (err) {
      const note = err instanceof Error ? err.message : String(err);
      console.warn(`[handover] couldn't take ${row.card_id} over: ${note}`);
      await setStatus(client, row.id, { status: "cancelled", note: `Couldn't start your card: ${note}`.slice(0, 500) }).catch(() => false);
    }
  }
}

// How far back your own asks are read: an old answer has nothing left to say on the card.
export const HANDOVER_RECENT_MS = 24 * 60 * 60 * 1000;
const OPEN: HandoverStatus[] = ["asked", "pushing", "pushed", "failed", "declined", "cancelled"];
const COLUMNS = "id, org_id, card_id, by_user, owner_user, status, branch, sha, note, created_at";

// The asks on your cards (`owner`: still waiting for your answer) or yours (`asker`: from the last day), newest first.
export async function handoversFor(client: SupabaseClient, side: "owner" | "asker", uid: string, orgs: string[], now = Date.now()): Promise<HandoverRow[]> {
  if (!orgs.length) return [];
  const base = client.from("cloud_handovers").select(COLUMNS).in("org_id", orgs);
  const query = side === "owner" ? base.eq("owner_user", uid).eq("status", "asked") : base.eq("by_user", uid).in("status", OPEN).gt("created_at", new Date(now - HANDOVER_RECENT_MS).toISOString());
  const { data, error } = await query.order("created_at", { ascending: false }).limit(200);
  if (error && error.code !== "42P01" && error.code !== "PGRST205") console.warn(`[handover] couldn't read asks: ${error.message}`);
  return data ?? [];
}
