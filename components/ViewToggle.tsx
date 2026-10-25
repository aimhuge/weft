"use client";

// The board/list switch in the project bar: two icons, the one in use lit. It sits beside the
// sort menu, so the layout choice and the order choice are in the same place.
import type { ViewMode } from "@/lib/board-prefs";
import Icon from "./Icon";

const OPTIONS: { mode: ViewMode; icon: "columns" | "list"; label: string; hint: string }[] = [
  { mode: "board", icon: "columns", label: "Board", hint: "Show cards in columns" },
  { mode: "list", icon: "list", label: "List", hint: "Show every card in one list" },
];

export default function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <div role="group" aria-label="Board layout" className="flex shrink-0 items-center gap-0.5 rounded-md border border-line-strong bg-canvas p-0.5">
      {OPTIONS.map((o) => {
        const on = mode === o.mode;
        return (
          <button
            key={o.mode}
            onClick={() => onChange(o.mode)}
            aria-pressed={on}
            title={o.hint}
            aria-label={o.label}
            className={`rounded p-1 transition-colors ${on ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink"}`}
          >
            <Icon name={o.icon} size={13} />
          </button>
        );
      })}
    </div>
  );
}
