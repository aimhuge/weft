"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ViewMode } from "./board-prefs";

// How long the hint stays up after Escape flips the view: long enough to read it, short enough that
// it doesn't sit over the board.
const HINT_MS = 4000;

// The little pane that says where Escape just took you. It is the board's own escape layer
// (lib/use-escape-view.ts) announcing itself, so the hint and the flip can never disagree.
export type ViewHint = { mode: ViewMode; id: number };

// The other view's name, in the board's own words.
export function viewLabel(mode: ViewMode): string {
  return mode === "board" ? "Board" : "List";
}

// The hint for a flip to `mode`: what you are looking at now, and what the next Escape does. The
// view's name is separate so the toast can set it in accent and weight, and the eye lands on the
// answer before the sentence around it.
export function hintTitle(mode: ViewMode): string {
  return `${viewLabel(mode)} view`;
}

// What the next Escape would take you to: the view you're not in now.
export function hintOther(mode: ViewMode): string {
  return viewLabel(mode === "board" ? "list" : "board");
}

export function hintText(mode: ViewMode): string {
  return `${hintTitle(mode)}. Hit Esc again to switch to ${hintOther(mode).toLowerCase()} view.`;
}

// The tail of the toast, after the view's name: what the next Escape does.
export function hintOtherText(mode: ViewMode): string {
  return `hit Esc again to switch to ${hintOther(mode).toLowerCase()} view`;
}

// The state behind the hint: the last flip, and a way to clear it. `id` counts the flips, so the
// pane can key itself on it and restart its timer when Escape is pressed again.
export function useViewHint() {
  const [hint, setHint] = useState<ViewHint | null>(null);
  const count = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHint(null);
  }, []);

  // The hint for the view Escape just switched to.
  const show = useCallback((mode: ViewMode) => {
    if (timer.current) clearTimeout(timer.current);
    count.current += 1;
    setHint({ mode, id: count.current });
  }, []);

  useEffect(() => {
    if (!hint) return;
    timer.current = setTimeout(() => setHint(null), HINT_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [hint]);

  return { hint, show, clear };
}
