"use client";

import { useEffect } from "react";
import type { ThreadItem } from "@/lib/types";
import { lastLocalUrl } from "@/lib/review-tour";
import { usePaneOpen } from "@/lib/pane-open";

// A Review card whose thread wrote no tour (it predates them): still show its app, and offer to ask for one or finish.
export function ReviewPanelNoTour({ cardId, items, onSend }: { cardId: string; items: ThreadItem[]; onSend: (text: string) => Promise<void> }) {
  const url = lastLocalUrl(items);
  // This Mac's pane, or a worker card's own pane column (lib/pane-open.ts).
  const openPage = usePaneOpen(cardId);
  useEffect(() => {
    if (url) openPage(url);
  }, [url, openPage]);

  return (
    <section className="flex items-center gap-2 border-t border-line bg-accent-soft/40 px-4 py-2 text-[12px]">
      <span className="min-w-0 flex-1 text-muted">No review tour yet{url ? ` · showing ${url}` : ""}</span>
      <button
        onClick={() =>
          void onSend(
            "Write a review tour for what you built: end your reply with a weft-review block (one step per feature, what to look for, and the page), then the BOARD STATUS line.",
          )
        }
        className="shrink-0 rounded-md border border-line-strong px-2.5 py-1 text-[12px] text-ink hover:bg-sunken"
      >
        Build review tour
      </button>
      {/* Done without a tour: wraps the thread up with Weft's done skill, as a tour's last step does. */}
      <button
        onClick={() => void onSend("/weft:done")}
        className="shrink-0 rounded-md bg-accent px-3 py-1 text-[12px] font-medium text-on-accent hover:opacity-90"
      >
        Done
      </button>
    </section>
  );
}