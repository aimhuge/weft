// Share links for a card: one URL (weft.zip/s/<id>) that shows the card's thread and the page its browser pane
// shows, live (docs/architecture/sharing.md). The contract between the parts:
// - the desktop writes a cloud_shares row through the signed-in account (app/api/cards/[id]/share, lib/card-share.ts),
// - the deployed Weft reads it with the service client, checks the gate (lib/share-gate.ts, lib/share-access.ts) and
//   serves the viewer (app/s/[id]) and its live poll (app/api/s/[id]/live),
// - the card's rows are the ones cloud sync already uploads (lib/cloud-sync.ts), so a card is shared only from a synced folder.
// Modes come from @aimhuge/share; a card never takes "public_edit" (editing a thread would run turns on the owner's Mac).
import { isShareMode, type ShareMode } from "@aimhuge/share";
import type { SharePane } from "@weft/client";
import { SITE } from "./site";
import type { Card, ThreadItem } from "./types";

export type CardShareMode = Exclude<ShareMode, "public_edit">;

export const CARD_SHARE_MODES: readonly CardShareMode[] = ["private", "public", "email", "password"];

export function isCardShareMode(value: unknown): value is CardShareMode {
  return isShareMode(value) && value !== "public_edit";
}

// public.cloud_shares: one per shared card. `private` keeps the row (and its id) so re-opening reuses the link.
export interface CloudShareRow {
  id: string;
  org_id: string;
  card_id: string;
  mode: CardShareMode;
  // scrypt hash from @aimhuge/share/server hashSharePassword. Clients can't select it (column grants); they read
  // has_password, a generated column, instead.
  password_hash?: string | null;
  has_password?: boolean;
  // The link's address under its sharer, weft.zip/@<username>/threads/<slug>; null on links made before slugs.
  slug?: string | null;
  // false: the viewer shows the card's header and pane only, and the live poll never sends the thread's items.
  show_chat?: boolean;
  // The database fills it in (auth.uid()); the desktop never sends it.
  created_by?: string;
  created_at: string;
  updated_at: string;
}

// public.cloud_share_visits: who got through an email gate (and when anyone opened a link).
export interface CloudShareVisitRow {
  share_id: string;
  email: string | null;
  at: string;
}

// 16 random bytes as base64url: 22 characters, unguessable, safe in a path.
export const SHARE_ID_RE = /^[A-Za-z0-9_-]{16,32}$/;

export function newShareId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function shareUrl(id: string, origin = SITE): string {
  return `${origin}/s/${id}`;
}

// A thread link's address under its sharer, like a mini app's (lib/app-share-types.ts appPublicUrl).
export function threadPublicUrl(username: string, slug: string, origin = SITE): string {
  return `${origin}/@${username}/threads/${slug}`;
}

// The address to copy: the slug one when the link has both a slug and a sharer with a username, else /s/<id>.
export function cardShareLink(id: string, slug: string | null | undefined, username: string | null | undefined): string {
  return slug && username ? threadPublicUrl(username, slug) : shareUrl(id);
}

// What GET/PUT /api/cards/[id]/share answer on the desktop, for the Share dialog.
export type CardShareState =
  | { kind: "signed-out" }
  | { kind: "no-workspace" }
  // The card's folder isn't in settings `syncFolders`, so nothing of it is on Supabase to share.
  | { kind: "not-synced"; folder: string }
  // Synced, but the card's row hasn't reached cloud_cards yet (the outbox flushes within ~10 s).
  | { kind: "pending" }
  | { kind: "ok"; id: string | null; url: string | null; mode: CardShareMode; hasPassword: boolean; slug: string | null; showChat: boolean };

// What the Share dialog draws before the server answers: the share the card remembers (card.share, kept by
// lib/card-share.ts), or a private one; signed out, the sign-in. The server's answer replaces it a moment later.
export function seedShareState(card: Pick<Card, "share">, signedOut: boolean): CardShareState {
  if (signedOut) return { kind: "signed-out" };
  const memo = card.share;
  if (!memo) return { kind: "ok", id: null, url: null, mode: "private", hasPassword: false, slug: null, showChat: true };
  const url = memo.url ?? (memo.id ? shareUrl(memo.id) : null);
  return { kind: "ok", id: memo.id, url, mode: memo.mode, hasPassword: memo.hasPassword, slug: memo.slug ?? null, showChat: memo.showChat ?? true };
}

// PUT /api/cards/[id]/share. A password is hashed on the Mac and only its hash goes up; omitted keeps the old one.
// showChat and slug are left as they are when omitted; a slug that's taken is refused (409).
export interface CardShareUpdate {
  mode: CardShareMode;
  password?: string;
  showChat?: boolean;
  slug?: string;
}

// GET /api/s/[id]/live?after=<seq> (new items) or ?before=<seq> (older page), as the viewer polls it.
// Items are newest first like the thread route, already redacted (lib/share-redact.ts) and with blob refs left in;
// blobUrls maps every ref they, the pane capture and the card's thumb use to an hour-long signed URL.
// What a viewer gets of the card: enough for the header and the pane's fallback picture, never its folder, session,
// pending questions or tasks (lib/share-view.ts toShareCard).
export type ShareCard = Pick<Card, "id" | "title" | "emoji" | "column" | "tags" | "thumb">;

export interface ShareLive {
  card: ShareCard;
  items: { seq: number; item: ThreadItem }[];
  hasOlder: boolean;
  pane: SharePane | null;
  blobUrls: Record<string, string>;
  // The sharer's choice: false means items is always empty and the viewer shows the pane alone.
  showChat: boolean;
}

// How often the viewer polls while its tab is visible.
export const SHARE_POLL_MS = 4000;

// The pane a share shows, and a worker screen's page string: @weft/client, shared with the web board and the phone.
export { paneFor, paneFromUrl, screenPage, screenTopic, SCREEN_EVENT, type ScreenDevice, type SharePane } from "@weft/client";
