// The Mac's side of a card's share link (lib/share-types.ts, docs/architecture/sharing.md): the Share dialog
// (components/ShareCardDialog.tsx) reads and sets the card's cloud_shares row through app/api/cards/[id]/share.
// It writes as the signed-in account, into the workspace cloud sync uploads to, so RLS decides who may share:
// only the card's owner. A share points at the card's cloud_cards row, so a card is shared only once cloud
// sync has uploaded it; until then the dialog is told why (signed out, no workspace, not synced, pending).
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashSharePassword } from "@aimhuge/share/server";
import { accountClient } from "./account";
import { syncNow, syncOrgId } from "./cloud-sync";
import { recordExplore } from "./explore";
import { syncFolders } from "./settings";
import { decorateCard, getCard } from "./store";
import { isCardShareMode, newShareId, shareUrl, type CardShareMode, type CardShareState, type CardShareUpdate } from "./share-types";

// A refusal the route turns into its status (a missing card is a 404, a bad request a 400).
export class CardShareError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// The columns a client may read: password_hash is left out of the column grant on purpose.
type ShareRead = { id: string; mode: string; has_password: boolean | null };

// Where the card's share would live, or why it can't be shared yet.
type Target = { kind: "ready"; client: SupabaseClient; orgId: string } | { kind: "blocked"; state: CardShareState };

function safeClient(): SupabaseClient | null {
  try {
    return accountClient();
  } catch {
    return null; // accounts aren't set up in this build
  }
}

function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

async function target(cardId: string): Promise<Target> {
  const card = getCard(cardId);
  if (!card) throw new CardShareError("No such card.", 404);
  const client = safeClient();
  const { data } = client ? await client.auth.getSession() : { data: { session: null } };
  const userId = data.session?.user.id;
  if (!client || !userId) return { kind: "blocked", state: { kind: "signed-out" } };
  const orgId = await syncOrgId(client, userId);
  if (!orgId) return { kind: "blocked", state: { kind: "no-workspace" } };
  if (!syncFolders().includes(card.cwd)) return { kind: "blocked", state: { kind: "not-synced", folder: card.cwd } };
  // The share's foreign key needs the card's row; nudge the outbox and let the dialog ask again.
  const row = await client.from("cloud_cards").select("card_id").eq("org_id", orgId).eq("card_id", cardId).maybeSingle();
  check(row.error);
  if (!row.data) {
    syncNow();
    return { kind: "blocked", state: { kind: "pending" } };
  }
  return { kind: "ready", client, orgId };
}

async function readShare(client: SupabaseClient, orgId: string, cardId: string): Promise<ShareRead | null> {
  const { data, error } = await client
    .from("cloud_shares")
    .select("id, mode, has_password")
    .eq("org_id", orgId)
    .eq("card_id", cardId)
    .maybeSingle<ShareRead>();
  check(error);
  return data;
}

// A row with a mode this build doesn't know reads as private: fail closed.
function stateOf(row: ShareRead | null): CardShareState {
  if (!row) return { kind: "ok", id: null, url: null, mode: "private", hasPassword: false };
  const mode: CardShareMode = isCardShareMode(row.mode) ? row.mode : "private";
  return { kind: "ok", id: row.id, url: shareUrl(row.id), mode, hasPassword: Boolean(row.has_password) };
}

// Keeps card.share current, so the next Share dialog draws from it without waiting on Supabase.
function remember(cardId: string, state: CardShareState): CardShareState {
  if (state.kind !== "ok") return state;
  const memo = { id: state.id, mode: state.mode, hasPassword: state.hasPassword };
  const had = getCard(cardId)?.share;
  if (had?.id !== memo.id || had.mode !== memo.mode || had.hasPassword !== memo.hasPassword) decorateCard(cardId, { share: memo });
  return state;
}

export async function getCardShare(cardId: string): Promise<CardShareState> {
  const t = await target(cardId);
  if (t.kind === "blocked") return t.state;
  return remember(cardId, stateOf(await readShare(t.client, t.orgId, cardId)));
}

export async function setCardShare(cardId: string, update: CardShareUpdate): Promise<CardShareState> {
  // Never public_edit: a stranger editing the thread would run turns on this Mac.
  if (!isCardShareMode(update.mode)) throw new CardShareError("Unknown share mode.", 400);
  const password = typeof update.password === "string" && update.password !== "" ? update.password : undefined;
  const t = await target(cardId);
  if (t.kind === "blocked") return t.state;
  const existing = await readShare(t.client, t.orgId, cardId);
  if (update.mode === "password" && !password && !existing?.has_password) throw new CardShareError("Set a password first.", 400);
  const change: Record<string, unknown> = { mode: update.mode };
  // Only the hash goes up. Leaving the password gate drops the old one, so it can't come back unseen.
  if (update.mode !== "password") change.password_hash = null;
  else if (password) change.password_hash = hashSharePassword(password);
  // An update or an insert that asks nothing back, never an upsert: ON CONFLICT DO UPDATE reads excluded.password_hash,
  // which clients can't select (the migration's column grants), and the database refuses the whole statement.
  const shares = t.client.from("cloud_shares");
  const { error } = existing
    ? await shares.update(change).eq("org_id", t.orgId).eq("card_id", cardId)
    : await shares.insert({ ...change, id: newShareId(), org_id: t.orgId, card_id: cardId });
  check(error);
  if (update.mode !== "private") void recordExplore("card-share");
  return remember(cardId, stateOf(await readShare(t.client, t.orgId, cardId)));
}
