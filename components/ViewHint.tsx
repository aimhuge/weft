"use client";

import { hintOtherText, hintTitle } from "@/lib/use-view-hint";
import type { ViewMode } from "@/lib/board-prefs";
import Icon from "./Icon";

// The little pane under the board/list toggle: it says where Escape just took you, so the flip
// isn't silent. It sits in the project bar's own row (absolutely positioned), so it takes no
// vertical space on a small screen, and it closes itself after a moment (lib/use-view-hint.ts).
//
// It is deliberately loud. The first version was a grey box in the bar's own grey, 11.5px, and it
// read as a tooltip rather than an announcement. So it is a real toast now: big type, an accent
// tile carrying the view's icon, a bright accent border and a wide glow.
//
// It is one row, never wrapped. An absolutely-positioned box with no width shrinks to its content
// and then wraps the text into a narrow column, which left the icon adrift and the ✕ orphaned;
// `w-max` and `whitespace-nowrap` keep the icon, the words and the ✕ on one line, balanced.
export default function ViewHint({ mode, onDismiss }: { mode: ViewMode; onDismiss: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="view-hint-pop pointer-events-none absolute right-0 top-full z-50 mt-2 flex w-max max-w-[min(92vw,30rem)] items-center gap-3 rounded-xl border-2 border-accent bg-panel px-3.5 py-2.5 text-[15px] leading-none text-ink"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-on-accent">
        <Icon name={mode === "board" ? "columns" : "list"} size={19} />
      </span>
      <span className="whitespace-nowrap">
        <span className="font-semibold text-accent">{hintTitle(mode)}</span>
        <span className="text-muted"> · {hintOtherText(mode)}</span>
      </span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="pointer-events-auto -mr-1 shrink-0 rounded p-1 text-muted hover:bg-sunken hover:text-ink"
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
