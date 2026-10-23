"use client";

import Icon from "./Icon";

// The small filter box Weft's lists share (the 🔐 drawer, the skills list, the project menu): a magnifier,
// the input, and Escape that clears the query first, so only an empty box lets Escape reach the drawer or menu.
// What the query matches is the list's own business; lib/text-filter.ts is the shared rule.
export default function SearchField({
  query,
  onQuery,
  label,
  autoFocus,
  onEnter,
  className = "",
}: {
  query: string;
  onQuery: (q: string) => void;
  label: string; // "Filter secrets": the placeholder and the accessible name
  autoFocus?: boolean;
  onEnter?: () => void; // Enter picks the list's top match
  className?: string;
}) {
  return (
    <label
      className={`flex items-center gap-1.5 rounded-md border border-line-strong bg-card px-1.5 py-0.5 text-muted focus-within:border-accent/60 ${className}`}
    >
      <Icon name="search" size={11} />
      <input
        type="search"
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && query) {
            e.stopPropagation();
            onQuery("");
          } else if (e.key === "Enter" && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
        placeholder={label}
        aria-label={label}
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-[11.5px] text-ink outline-none placeholder:text-faint"
      />
    </label>
  );
}
