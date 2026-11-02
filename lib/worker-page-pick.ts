// What a worker card's pane column shows when something on this Mac asks it to open a page (lib/use-project-host.ts
// `page.open`: the review tour's steps, the no-tour panel's app, the show rail). Those name the page as the worker
// wrote it, a path like /home/me/.weft-worker/data/show/plan.html or a localhost URL, and a path only exists on the
// worker: drawn as it is, the pane says "This page only exists on the machine running this card." over the blob the
// card already shows. So a path the card itself opened with mcp__browser__open_url is traded for the blob its worker
// uploaded then: the open_url item's summary is that ref (lib/blob-store.ts rewriteTool), and its result names the path
// it was asked for (lib/worker-pane.ts openOnWorker: "Opened <url> — <title>…", every worker version). Any other page
// that only exists on the worker opens nothing, so the pane stays on the card's own page. A ref, a site or a live
// screen goes through as it is. Nothing is fetched or widened: the ref framed is one the worker published itself.
import { paneFromUrl } from "./share-types";
import type { ThreadItem } from "./types";

const OPENED = /^Opened (\S+)/;

// A file page as a plain path with its anchor apart: "file:///a/b.html#x" and "/a/b.html#x" are the same page.
function fileOf(url: string): { path: string; hash: string } | null {
  const trimmed = url.trim();
  const raw = /^file:\/\//i.test(trimmed) ? trimmed.slice("file://".length) : trimmed;
  if (!raw.startsWith("/")) return null;
  const at = raw.indexOf("#");
  const bare = at < 0 ? raw : raw.slice(0, at);
  const hash = at < 0 ? "" : raw.slice(at);
  try {
    return { path: decodeURI(bare), hash };
  } catch {
    return { path: bare, hash };
  }
}

// The blob ref the card's own open_url of this file went up as, newest first; null when it never opened it.
function uploadedAs(file: { path: string }, items: readonly ThreadItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.kind !== "tool" || item.name !== "mcp__browser__open_url" || !item.result) continue;
    const pane = paneFromUrl(item.summary);
    if (pane?.kind !== "blob") continue;
    const asked = OPENED.exec(item.result.trim())?.[1];
    const opened = asked ? fileOf(asked) : null;
    if (opened?.path === file.path) return pane.ref;
  }
  return null;
}

// The page to put the pane on for `url`, or null to leave it where it is.
export function workerPagePick(url: string, items: readonly ThreadItem[]): string | null {
  const pane = paneFromUrl(url);
  if (!pane) return null;
  if (pane.kind !== "local") return url;
  const file = fileOf(pane.url);
  const ref = file ? uploadedAs(file, items) : null;
  return ref && file ? `${ref}${file.hash}` : null;
}
