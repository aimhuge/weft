"use client";

// A worker card's page in this Mac's native pane (components/WorkerPane.tsx), as a local card's pages are: a page the
// card wrote (a blob) through this Mac's server, as its frame on the board loads it (app/api/worker-board/page/[sha],
// whose sandbox CSP comes along), and a site as it is. The live screen, a page that only exists on the worker, and no
// page at all stay the board's own WebPane.
import { useEffect, useRef } from "react";
import type { SharePane } from "@/lib/share-types";

const PROXIED = /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/api\/worker-board\/page\/([0-9a-f]{64})(#.*)?$/;

// Where the native pane loads `pane`, given the board's own origin; null when the board's WebPane draws it instead.
export function nativePageUrl(pane: SharePane | null, origin: string): string | null {
  if (pane?.kind === "blob") return `${origin}/api/worker-board/page/${pane.ref.replace(/^blob:sha256:/, "")}${pane.hash}`;
  if (pane?.kind === "site") return pane.url;
  return null;
}

// What Save as app saves for the page the native pane shows: a worker card's page goes back to its blob ref, so the
// server brings it home (lib/mini-app-worker.ts) instead of saving this Mac's proxied address as a link.
export function savedPageUrl(url: string): string {
  const page = PROXIED.exec(url);
  return page ? `blob:sha256:${page[1]}${page[2] ?? ""}` : url;
}

// Puts the card's page in its native pane when the page changes (a new one from the card, the show rail, the review
// tour), and not when the card is only reopened on the page its pane already shows. The pane's own navigation after
// that is the user's: it isn't pulled back while the page stays the same.
export function useNativePage(cardId: string, url: string | null, current: string): void {
  const shown = useRef(current);
  useEffect(() => {
    shown.current = current;
  });
  useEffect(() => {
    if (url && url !== shown.current) window.weft?.browser.open(url, cardId).catch(() => {});
  }, [cardId, url]);
}
