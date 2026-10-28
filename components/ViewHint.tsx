"use client";

import { hintText } from "@/lib/use-view-hint";
import type { ViewMode } from "@/lib/board-prefs";
import Icon from "./Icon";

// The little pane under the board/list toggle: it says where Escape just took you, so the flip
// isn't silent. It sits in the project bar's own row (absolutely positioned), so it takes no
// vertical space on a small screen, and it closes itself after a moment (lib/use-view-hint.ts).
export default function ViewHint({ mode, onDismiss }: { mode: ViewMode; onDismiss: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute right-0 top-full z-50 mt-1 flex items-center gap-1.5 whitespace-nowrap rounded-md border border-line-strong bg-panel px-2.5 py-1.5 text-[11.5px] leading-snug text-ink shadow-lg"
    >
      <Icon name={mode === "board" ? "columns" : "list"} size={13} className="text-accent" />
      <span>{hintText(mode)}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="pointer-events-auto -mr-1 rounded p-0.5 text-muted hover:text-ink"
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}
