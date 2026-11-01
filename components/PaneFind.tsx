"use client";

import { useEffect, useRef, useState } from "react";
import { paneFindFocused } from "@/lib/find-events";
import { useEscape } from "@/lib/use-escape";
import FindField from "./FindField";

// Find in the page in the browser pane. Electron main decides a ⌘F is ours (the page has the focus) and does the
// searching (electron/pane-find.cjs); this holds the query and the count.
export function usePaneFind({ url, tab }: { url?: string; tab?: number | null }) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ active: number; matches: number } | null>(null);

  function step(by: 1 | -1) {
    if (query) window.weft?.browser.find?.(query, { forward: by === 1, next: true });
  }
  function close() {
    setOpen(false);
    setQuery("");
    setFound(null);
    window.weft?.browser.stopFind?.(true);
  }
  // The menu listener is set up once; this is what it reads the latest step and open through.
  const latest = useRef({ step, open });
  useEffect(() => {
    latest.current = { step, open };
  });

  useEffect(() => {
    const offMenu = window.weft?.onMenu((action, payload) => {
      const mine = payload === "pane" || paneFindFocused();
      if (action === "find" && mine) {
        setOpen(true);
        setFocus((n) => n + 1);
      }
      if ((action === "find-next" || action === "find-previous") && mine && latest.current.open) latest.current.step(action === "find-next" ? 1 : -1);
    });
    const offFound = window.weft?.browser.onFound?.(setFound);
    return () => {
      offMenu?.();
      offFound?.();
    };
  }, []);

  // A new page or tab searches again for what's typed; main moves the find to whichever page is on screen.
  useEffect(() => {
    if (!open) return;
    if (query) window.weft?.browser.find?.(query);
    else window.weft?.browser.stopFind?.(false);
  }, [open, query, url, tab]);

  // Closing the card or the pane mid-find leaves no highlights behind in its page.
  useEffect(() => {
    if (!open) return;
    return () => window.weft?.browser.stopFind?.(false);
  }, [open]);

  // Esc reaches here from the field, and from the page by way of its replay into the board (electron/pane-escape.cjs).
  useEscape(open, close);

  const count = !query || !found ? (query ? "…" : "") : `${found.matches ? Math.max(found.active, 1) : 0} of ${found.matches}`;
  return { open, focus, query, setQuery: (next: string) => { setQuery(next); if (!next) setFound(null); }, step, close, count };
}

export function PaneFindField({ find }: { find: ReturnType<typeof usePaneFind> }) {
  return (
    <div data-pane-find className="mx-1 min-w-0 flex-1">
      <FindField query={find.query} count={find.count} focus={find.focus} placeholder="Find in page" onQuery={find.setQuery} onStep={find.step} onClose={find.close} />
    </div>
  );
}
