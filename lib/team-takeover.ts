// Taking over a teammate's card (docs/architecture/cloud-sync.md#taking-over-a-teammates-card): "Continue here" on
// their card makes a new card of yours, in your checkout of its repo (lib/team-board.ts repoFolders), with their thread
// as its history and a brief its first session starts from (lib/team-takeover-brief.ts), and leaves a row in
// cloud_card_takeovers so every board marks their card as taken. Their card stays theirs: nothing here writes their
// rows, and their Mac isn't asked anything, so it works while it's off. Their session and their unpushed edits stay
// on their Mac; the brief says so.
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { threadPageIn } from "./cloud-thread-read";
import { summaryPrompt, touchedFiles } from "./handoff";
import { complete } from "./haiku";
import { createCardFromBody } from "./new-card";
import { sendMessage } from "./runner";
import { getCard, replaceThread, updateCard } from "./store";
import { repoFolders } from "./team-board";
import { type Handed, importedItems, TAKEOVER_ITEMS_MAX, takeoverBrief, takeoverMessage } from "./team-takeover-brief";
import type { Card, ThreadItem } from "./types";
import { openCardRows } from "./worker-board-open";

interface CardRow {
  card_id: string;
  owner_user: string;
  repo: string | null;
  card: Card;
  deleted?: boolean;
}

export interface Takeover {
  card: Card;
  // Whether the takeover row went up, so their card shows as taken; a database without the table yet says no.
  marked: boolean;
}

async function cardRow(client: SupabaseClient, org: string, cardId: string): Promise<CardRow | null> {
  const { data, error } = await client.from("cloud_cards").select("card_id, owner_user, repo, card, deleted").eq("org_id", org).eq("card_id", cardId).maybeSingle<CardRow>();
  if (error) throw new Error(`Couldn't read that card: ${error.message}`);
  if (!data) return null;
  const [opened] = await openCardRows(org, [data]);
  return opened ?? null;
}

async function ownerName(client: SupabaseClient, owner: string): Promise<string> {
  const { data } = (await client.from("profiles").select("display_name").eq("id", owner).maybeSingle()) as { data: { display_name: string | null } | null };
  return data?.display_name?.trim() || "A teammate";
}

// Their whole thread, oldest first, walked back a page at a time up to the most a takeover brings.
export async function wholeThread(client: SupabaseClient, org: string, cardId: string): Promise<ThreadItem[]> {
  let items: ThreadItem[] = [];
  let before: number | undefined;
  while (items.length < TAKEOVER_ITEMS_MAX) {
    const page = await threadPageIn(client, org, cardId, before);
    if (!page) throw new Error("Couldn't read that card's thread.");
    items = [...page.items, ...items];
    if (!page.items.length || page.start <= 0) break;
    before = page.start;
  }
  return items.slice(-TAKEOVER_ITEMS_MAX);
}

async function summarize(card: Card, items: ThreadItem[]): Promise<string> {
  try {
    const summary = await complete(summaryPrompt(card, items));
    if (summary.trim()) return summary;
  } catch {
    // Fall through to the card's own last words.
  }
  return card.lastLine ?? "(no summary available; read the thread above)";
}

// A database without cloud_card_takeovers yet (the app ships ahead of its migration) can't mark the card; the
// takeover itself still stands.
const missingTable = (error: { code?: string }) => error.code === "42P01" || error.code === "PGRST205";

async function markTakeover(client: SupabaseClient, org: string, cardId: string, newCardId: string): Promise<boolean> {
  const { error } = await client.from("cloud_card_takeovers").upsert({ org_id: org, card_id: cardId, new_card_id: newCardId }, { onConflict: "org_id,card_id,by_user", ignoreDuplicates: true });
  if (error && !missingTable(error)) console.warn(`[team-takeover] couldn't mark ${cardId} taken: ${error.message}`);
  return !error;
}

// `handed` is where their Mac pushed the card's work when they said yes to an ask (lib/handover.ts); without it, the
// card starts from what they had pushed already ("Take over now").
export async function takeOverTeamCard(org: string, cardId: string, client: SupabaseClient = accountClient(), folders = repoFolders, handed?: Handed): Promise<Takeover> {
  const { data } = await client.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) throw new Error("Sign in to Weft to take over a teammate's card.");
  const row = await cardRow(client, org, cardId);
  if (!row || row.deleted) throw new Error("That card isn't there anymore.");
  if (row.owner_user === uid) throw new Error("That card is already yours.");
  const repo = row.repo?.toLowerCase() ?? "";
  const folder = folders().get(repo);
  if (!folder) throw new Error(`Check out ${row.repo ?? "its repo"} on this Mac first: the card continues in your copy of it.`);
  const name = await ownerName(client, row.owner_user);
  const theirs = await wholeThread(client, org, cardId);
  const brief = takeoverBrief(row.card, name, repo, await summarize(row.card, theirs), touchedFiles(theirs), handed);
  const text = takeoverMessage(row.card, name, handed);
  const card = createCardFromBody({ prompt: text, cwd: folder, title: row.card.title, tags: row.card.tags ?? [] });
  updateCard(card.id, { takenFrom: { org, card: cardId, owner: row.owner_user, name, ...(handed ? { branch: handed.branch } : {}) } });
  replaceThread(card.id, [...importedItems(theirs, name), { kind: "spliced", at: Date.now(), brief }]);
  sendMessage(card.id, text, { cli: `${brief}${text}` });
  const marked = await markTakeover(client, org, cardId, card.id);
  return { card: getCard(card.id) ?? card, marked };
}
