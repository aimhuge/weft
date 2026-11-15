"use client";

import { toggleThread } from "@/lib/pane-rail-open";

// While the open card's thread shows beside the page, the strip under the page is gone (the thread column has the one
// reply box), so its "Hide thread" toggle sits in the pane's toolbar beside the ⧉ pill (docs/architecture/simple-mode.md).
export default function HideThread() {
  return (
    <button type="button" onClick={toggleThread} title="Hide the thread" className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11.5px] text-muted hover:bg-sunken hover:text-ink">
      Hide thread
    </button>
  );
}
