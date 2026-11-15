"use client";

import { toggleRail, useRailOpen } from "@/lib/pane-rail-open";
import type { Card, ThreadItem } from "@/lib/types";
import { useMiniCount } from "./ShowRail";

// The full-page pane's folded show rail (docs/architecture/simple-mode.md, piece 1): "⧉ 7", the count of the rail's
// minis. Clicking it opens the rail beside the page, which shrinks to make room (the page is a native view, so
// nothing can float over it); clicking again folds it. The choice lasts the session (lib/pane-rail-open.ts).
export default function RailPill({ card, items }: { card: Card; items: ThreadItem[] }) {
  const open = useRailOpen();
  const count = useMiniCount(card, items);
  return (
    <button
      type="button"
      onClick={toggleRail}
      aria-pressed={open}
      aria-label={open ? "Fold the show rail" : `Open the show rail (${count})`}
      title={open ? "Fold the show rail" : "Open the show rail"}
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11.5px] tabular-nums ${open ? "border-accent bg-accent/10 text-ink" : "border-line text-muted hover:bg-sunken hover:text-ink"}`}
    >
      ⧉ {count}
    </button>
  );
}

