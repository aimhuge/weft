"use client";

import { useEffect, useRef } from "react";
import Icon from "./Icon";

// The compact find field: a query, where you are in the matches, ↑ ↓ and ✕. Enter steps down the list and
// Shift+Enter back up. The thread floats it over its messages (components/ThreadView.tsx); the browser pane
// puts it in the address bar's place (components/PaneFind.tsx), since nothing can sit over a native view.
export default function FindField({
  query,
  count,
  focus,
  placeholder,
  onQuery,
  onStep,
  onClose,
  className = "",
}: {
  query: string;
  count: string;
  // Changes when ⌘F asks for the field again: it takes the focus and selects what's typed.
  focus: number;
  placeholder: string;
  onQuery: (query: string) => void;
  onStep: (by: 1 | -1) => void;
  onClose: () => void;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focus]);

  const button = "shrink-0 rounded p-0.5 text-muted hover:bg-sunken hover:text-ink disabled:opacity-30";
  const empty = !query || count === "0 of 0";
  return (
    <div className={`flex min-w-0 items-center gap-1 rounded-md border border-line bg-canvas px-1.5 py-0.5 focus-within:border-accent ${className}`}>
      <input
        ref={input}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (query) onStep(e.shiftKey ? -1 : 1);
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent py-0.5 text-[12px] text-ink outline-none placeholder:text-faint"
      />
      {count && <span aria-live="polite" className="shrink-0 text-[11px] tabular-nums text-faint">{count}</span>}
      <button type="button" className={button} disabled={empty} onClick={() => onStep(-1)} title="Previous (⇧↵)" aria-label="Previous match">
        <Icon name="chevronDown" size={13} className="rotate-180" />
      </button>
      <button type="button" className={button} disabled={empty} onClick={() => onStep(1)} title="Next (↵)" aria-label="Next match">
        <Icon name="chevronDown" size={13} />
      </button>
      <button type="button" className={button} onClick={onClose} title="Close (Esc)" aria-label="Close find">
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}
