// The page a card's browser pane shows, as far as its thread tells (docs/architecture/sharing.md, project-hosts.md#views):
// one page string from the thread as a pane (paneFromUrl), the pane as of the newest item (paneFor), and a worker's
// live screen as card.page names it (screenPage). The share viewer, the web board and the phone all draw from these;
// lib/share-types.ts re-exports them.
import { BLOB_REF_PREFIX, type BlobRef } from "./blob-ref";
import type { ThreadItem } from "./thread-items";

// What the viewer's right half shows: the latest page the card's pane showed, as far as the thread tells.
export type SharePane =
  // A ~/.weft/show page (or any local file) the outbox uploaded: served sandboxed by app/api/s/[id]/page/[sha].
  | { kind: "blob"; ref: BlobRef; hash: string; label: string }
  // A public site: framed directly (it may refuse to be framed; the viewer offers a link).
  | { kind: "site"; url: string; label: string }
  // Only reachable on the owner's Mac (localhost, a file that didn't upload): the viewer shows the card's pane capture.
  | { kind: "local"; url: string; label: string }
  // A worker's device, live: frames arrive on a Realtime Broadcast topic (lib/worker-screen.ts). Never in a thread item,
  // only in card.page, so a share link can't carry it.
  | { kind: "screen"; url: string; label: string; token: string; device: string; until: number; fast: boolean; devices: ScreenDevice[] };

// A worker's live screen as card.page names it. The token is the channel's secret: the channel is public, because a
// worker has no session, so whoever can read the card's row can watch, and nobody else (weft-worker.md#the-live-screen).
const SCREEN_PAGE = /^weft-screen:([0-9a-f]{32})\?(.*)$/;
export const SCREEN_EVENT = "frame";
export const screenTopic = (token: string) => `worker-screen:${token}`;

// The worker's other devices, for the pane's device menu: few enough to ride in card.page.
export type ScreenDevice = { id: string; name: string };
const MAX_DEVICES = 40;

// fast: this watch also takes a WebRTC offer (lib/use-rtc-screen.ts).
export function screenPage(token: string, d: { id: string; name: string }, until: number, fast = false, devices: ScreenDevice[] = []) {
  const params = new URLSearchParams({ device: d.id, name: d.name, until: String(until) });
  if (fast) params.set("fast", "1");
  if (devices.length) params.set("devices", JSON.stringify(devices.slice(0, MAX_DEVICES).map((x) => [x.id, x.name])));
  return `weft-screen:${token}?${params.toString()}`;
}

function devicesOf(raw: string | null): ScreenDevice[] {
  try {
    const list: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(list)) return [];
    return list.flatMap((x: unknown) => (Array.isArray(x) && typeof x[0] === "string" && typeof x[1] === "string" ? [{ id: x[0], name: x[1] }] : [])).slice(0, MAX_DEVICES);
  } catch {
    return [];
  }
}

function screenPane(url: string): SharePane | null {
  const found = SCREEN_PAGE.exec(url);
  if (!found) return null;
  const [, token = "", query] = found;
  const params = new URLSearchParams(query);
  const device = params.get("device");
  const until = Number(params.get("until"));
  if (!device || !Number.isFinite(until)) return null;
  return { kind: "screen", url, label: params.get("name") || device, token, device, until, fast: params.get("fast") === "1", devices: devicesOf(params.get("devices")) };
}

// A page sent up as a blob, with what followed its file: an #anchor, or a ?query (a review step, lib/review-blobs.ts).
const BLOB_PAGE = /^(blob:sha256:[0-9a-f]{64})([?#].*)?$/;
const LOCAL = /^(file:|\/)|^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i;

function pageLabel(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === "file:") return decodeURIComponent(u.pathname).split("/").filter(Boolean).slice(-2).join("/") + u.hash;
    return `${u.host}${u.pathname.replace(/\/$/, "")}${u.hash}`;
  } catch {
    return url.split("/").filter(Boolean).slice(-2).join("/");
  }
}

// One page string from the thread (an open_url call's summary, a user message's `page`) as a pane.
export function paneFromUrl(raw: string): SharePane | null {
  const url = raw.trim();
  if (!url) return null;
  if (url.startsWith("weft-screen:")) return screenPane(url);
  const blob = BLOB_PAGE.exec(url);
  if (blob) return { kind: "blob", ref: blob[1] as BlobRef, hash: blob[2] ?? "", label: "Page" };
  if (url.startsWith(BLOB_REF_PREFIX)) return null;
  if (LOCAL.test(url)) return { kind: "local", url, label: pageLabel(url) };
  if (/^https?:\/\//i.test(url)) return { kind: "site", url, label: pageLabel(url) };
  return null;
}

// The pane as of the newest item: the last mcp__browser__open_url call, or the page a message was sent with.
// Items may come in any order; the newest `at` wins (ties: later in the list).
export function paneFor(items: readonly ThreadItem[]): SharePane | null {
  let best: { at: number; pane: SharePane } | null = null;
  for (const item of items) {
    const raw = item.kind === "tool" && item.name === "mcp__browser__open_url" ? item.summary : item.kind === "user" ? item.page : undefined;
    const pane = raw ? paneFromUrl(raw) : null;
    if (pane && (!best || item.at >= best.at)) best = { at: item.at, pane };
  }
  return best?.pane ?? null;
}
