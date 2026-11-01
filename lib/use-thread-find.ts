import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { clearFindHighlights, paintFindHighlights, scrollToRange } from "./find-highlight";
import { onThreadFind, onThreadFindStep } from "./find-events";
import type { FindReveal } from "./find-reveal";
import { pulse, turnRow } from "./show-events";
import { useEscape } from "./use-escape";
import { turnId } from "./show-rail";
import { findCount, matchThread, spotAt, type FindMatch } from "./thread-find";
import type { ThreadPage } from "./thread-page";
import type { ThreadItem } from "./types";

const SEARCH_DELAY_MS = 120;
// A streaming reply changes the DOM many times a second; once it settles is soon enough to repaint.
const REPAINT_DELAY_MS = 120;

export interface ThreadFindOptions {
  // Only a card's own thread panel answers ⌘F: the copilot's chat is drawn too, and shouldn't open with it.
  enabled: boolean;
  cardId: string;
  page: ThreadPage;
  // The items as drawn (the page plus sends on their way) and the key of each row they make.
  items: readonly ThreadItem[];
  rowKeys: readonly number[];
  scroller: RefObject<HTMLElement | null>;
  // The transport's search over the whole thread; without one, find covers the loaded window.
  search?: (cardId: string, query: string) => Promise<FindMatch[] | null>;
  // Loads the page that ends at `before`, walking the window back to a match above it.
  loadOlder: (before: number) => Promise<void>;
  // Find scrolled the thread, so it should stop following the bottom.
  onJump: () => void;
}

// ⌘F in an open thread: the query, its matches over the whole thread, and the current match, kept loaded,
// unfolded, painted and on screen. The bar itself is components/FindField.tsx.
export function useThreadFind({ enabled, cardId, page, items, rowKeys, scroller, search, loadOlder, onJump }: ThreadFindOptions) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const [query, setQueryState] = useState("");
  const [matches, setMatches] = useState<FindMatch[] | null>(null);
  const [ordinal, setOrdinal] = useState(0);

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setMatches(null);
    setOrdinal(0);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    clearFindHighlights();
  }, [setQuery]);
  const step = useCallback((by: 1 | -1) => setOrdinal((n) => n + by), []);

  useEffect(() => {
    if (!enabled) return;
    const offOpen = onThreadFind(() => {
      setOpen(true);
      setFocus((n) => n + 1);
    });
    const offStep = onThreadFindStep((by) => {
      if (open) step(by);
    });
    return () => {
      offOpen();
      offStep();
    };
  }, [enabled, open, step]);

  // The loaded window for a transport with no search. Read through a ref so a new row re-runs the search
  // by way of page.total below, not on every streamed change.
  const loaded = useRef(page);
  useEffect(() => {
    loaded.current = page;
  });
  useEffect(() => {
    if (!open || !query) return;
    let stale = false;
    const run = async () => {
      const { items: window, start } = loaded.current;
      const found = search ? await search(cardId, query) : null;
      if (!stale) setMatches(found ?? matchThread(window, query, start));
    };
    const timer = setTimeout(() => void run(), SEARCH_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [open, query, page.total, cardId, search]);

  const spot = matches ? spotAt(matches, ordinal) : undefined;
  const local = spot && spot.index - page.start;
  const inWindow = local !== undefined && local >= 0;
  const reveal: FindReveal = (inWindow && items[local]) || null;
  // Folded runs draw as one row, keyed by their first item, so the match's row is the last key at or above it.
  const rowKey = inWindow ? rowKeys.findLast((key) => key <= local) : undefined;

  // A match above the window: walk back to it, a page at a time, as scrolling up would.
  const missing = spot !== undefined && !inWindow;
  useEffect(() => {
    if (missing) void loadOlder(page.start).catch(() => {});
  }, [missing, page.start, loadOlder]);

  // Paint after the reveal has committed, and again as rows change (a long result landing, a reply streaming).
  // The scroll happens once per match, waiting for its text if only its row is there so far.
  const landed = useRef<{ key: string; exact: boolean } | null>(null);
  const spotKey = spot ? `${query}:${spot.index}:${spot.nth}:${ordinal}` : "";
  const nth = spot?.nth ?? 0;
  useEffect(() => {
    const el = scroller.current;
    if (!open || !el || !query) return;
    const paint = () => {
      const row = rowKey === undefined ? null : turnRow(el, turnId(rowKey));
      const range = paintFindHighlights(el, query, row, nth);
      if (!row) return;
      const seen = landed.current?.key === spotKey;
      if (seen && (landed.current?.exact || !range)) return;
      landed.current = { key: spotKey, exact: Boolean(range) };
      onJump();
      if (range) scrollToRange(el, range);
      else row.scrollIntoView({ block: "center" });
      if (!seen) pulse(row);
    };
    paint();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(paint, REPAINT_DELAY_MS);
    });
    observer.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["open"] });
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [open, query, spotKey, rowKey, nth, scroller, onJump]);

  // Esc closes find before it closes the thread, from the field or anywhere else.
  useEscape(open, close);

  // Another card's thread, or this one going away, takes its paint with it.
  useEffect(() => clearFindHighlights, [cardId]);

  return { open, focus, query, setQuery, close, step, reveal, count: findCount(query, matches, ordinal) };
}

export type ThreadFind = ReturnType<typeof useThreadFind>;
