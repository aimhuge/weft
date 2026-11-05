// The pure view-side logic for the share viewer: how a poll response merges into the current
// state, and how a "Load earlier" response prepends. Kept here (a `lib` module, no React) so it has
// a unit test that doesn't need jsdom, and so the component file is JSX and styling only.
//
// The merge is by seq: a new item replaces an old one at the same seq (an in-place UPDATE), or
// prepends (an INSERT). The card and pane are replaced wholesale — the card rarely changes mid-
// view and the pane is the newest of the whole thread, so a fresh value is always what we want.
// blobUrls are merged: refs the response adds go in, refs neither side knows about stay, and a ref the viewer
// already has keeps its URL until it's near expiry (mergeBlobUrls).
import { BLOB_REF_PREFIX } from "./cloud-sync-types";
import type { ShareCard, SharePane, ShareLive } from "./share-types";
import type { Card } from "./types";

// How long before a signed URL expires that the viewer swaps it for the poll's fresh one.
export const BLOB_URL_RENEW_MS = 10 * 60 * 1000;

// When a Supabase signed URL stops working, in ms: the `exp` of the JWT in its `token` query. null when it has none.
export function signedUrlExpiry(url: string): number | null {
  try {
    const payload = new URL(url).searchParams.get("token")?.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: unknown };
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

// Every poll signs the card's blobs again, and a new signed URL is a new <img src>, so taking the poll's URL each
// time re-downloaded every picture every SHARE_POLL_MS: one open share tab pulled a 400 KB thumbnail 800 times an
// hour (1.6 GB of egress a day). A URL the viewer has keeps its place until it's within BLOB_URL_RENEW_MS of expiry.
export function mergeBlobUrls(prev: Record<string, string>, next: Record<string, string>, now = Date.now()): Record<string, string> {
  const out = { ...prev };
  for (const [ref, url] of Object.entries(next)) {
    const held = prev[ref];
    const expiry = held ? signedUrlExpiry(held) : null;
    if (!held || expiry === null || expiry - now < BLOB_URL_RENEW_MS) out[ref] = url;
  }
  return out;
}

// Merge a poll response into the viewer's current state. `prev` is the ShareLive the page was
// drawn from (or the result of the previous merge). `next` is what the server just answered. The
// order of items in the merged state is newest-first; the same `seq` on both sides replaces in
// place; a `seq` only in `next` prepends in seq order. `hasOlder` is the union: a page that said
// "yes, more" or a page that said "yes, this was a full page" both count.
export function mergeShareLive(prev: ShareLive, next: ShareLive): ShareLive {
  // The sharer hid the chat mid-view: drop what the viewer already has, not just the new items.
  if (!next.showChat) return { ...next, items: [], hasOlder: false, blobUrls: mergeBlobUrls(prev.blobUrls, next.blobUrls) };
  const bySeq = new Map<number, ShareLive["items"][number]>();
  // Pre-fill with prev so unknown seqs from `next` add in the right place.
  for (const entry of prev.items) bySeq.set(entry.seq, entry);
  for (const entry of next.items) bySeq.set(entry.seq, entry);
  const merged = [...bySeq.values()].sort((a, b) => b.seq - a.seq);
  return {
    card: next.card,
    items: merged,
    hasOlder: next.hasOlder || prev.hasOlder,
    pane: next.pane,
    blobUrls: mergeBlobUrls(prev.blobUrls, next.blobUrls),
    showChat: next.showChat,
  };
}

// A poll's worth of items is "newer than" the viewer's current newest seq. Compute that boundary
// here so the URL is built consistently (and the test asserts the rounding: half a non-integer
// seq still goes through, the poll just wastes one request).
export function newestSeq(live: ShareLive): number {
  return live.items[0]?.seq ?? 0;
}

// The opposite boundary: the oldest seq on screen is the next "before" cursor. The server is
// inclusive of the cursor's row; we want strictly older, so subtract 1 — but seqs are positive
// integers, so the safe form is `oldestSeq - 1` clamped at 0.
export function oldestSeq(live: ShareLive): number {
  let oldest = Number.POSITIVE_INFINITY;
  for (const entry of live.items) if (entry.seq < oldest) oldest = entry.seq;
  return Number.isFinite(oldest) ? oldest : 0;
}

// Whether the viewer is at "the top" of the thread (no older items to load). Mirrored on the
// server as `hasOlder`; this client-side version lets the component hide the "Load earlier" button
// without a round trip.
export function canLoadEarlier(live: ShareLive): boolean {
  return live.hasOlder && live.items.length > 0;
}

// The card row is the desktop's whole Card (folder, session id, a pending permission's text, task command lines), and a
// viewer may be anyone with the link. Copy only what the viewer draws. A thumb that isn't an uploaded blob is a path on the
// owner's Mac, so it goes too.
export function toShareCard(raw: unknown): ShareCard {
  const card = (raw && typeof raw === "object" ? raw : {}) as Partial<Card>;
  const text = (v: unknown) => (typeof v === "string" ? v : undefined);
  const thumb = text(card.thumb);
  return {
    id: text(card.id) ?? "",
    title: text(card.title) ?? "",
    column: card.column ?? "backlog",
    ...(text(card.emoji) ? { emoji: text(card.emoji) } : {}),
    ...(Array.isArray(card.tags) ? { tags: card.tags.filter((t): t is string => typeof t === "string") } : {}),
    ...(thumb?.startsWith(BLOB_REF_PREFIX) ? { thumb } : {}),
  };
}

// A page that only the owner's Mac can open (localhost, a local file) keeps its short label but not its address, which
// can carry a home folder.
export function publicPane(pane: SharePane | null): SharePane | null {
  return pane?.kind === "local" ? { ...pane, url: "" } : pane;
}
