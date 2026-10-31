"use client";

// The search box in Settings' title bar: type, and every page's sections that match drop down under it, best first.
// ↑/↓ move the highlight, Enter or a click opens that page at that section, Escape clears the box before it closes
// Settings, and ⌘F (or /) focuses it from anywhere on the screen. What it searches is lib/settings-search.ts.

import { useEffect, useId, useRef, useState } from "react";
import { searchSettings, type SettingsHit } from "@/lib/settings-search";
import Icon from "./Icon";

export default function SettingsSearch({ onPick }: { onPick: (hit: SettingsHit) => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const hits = searchSettings(query);
  const open = focused && query.trim() !== "";

  useEffect(() => {
    const focus = () => {
      input.current?.focus();
      input.current?.select();
    };
    const onKey = (e: KeyboardEvent) => {
      const inField = e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable=true]");
      if ((e.metaKey && e.key === "f") || (e.key === "/" && !inField)) {
        e.preventDefault();
        focus();
      }
    };
    window.addEventListener("keydown", onKey);
    // In the desktop app ⌘F is the Edit menu's Find, which never reaches the page as a key; it comes as a menu action.
    const offMenu = window.weft?.onMenu((action) => {
      if (action === "find") focus();
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      offMenu?.();
    };
  }, []);

  function pick(hit: SettingsHit | undefined) {
    if (!hit) return;
    onPick(hit);
    setQuery("");
    input.current?.blur();
  }

  return (
    <div className="relative w-[260px] max-w-[45vw]" onMouseDown={(e) => e.stopPropagation()}>
      <label className="flex items-center gap-1.5 rounded-md border border-line-strong bg-card px-2 py-1 text-muted focus-within:border-accent/60">
        <Icon name="search" size={12} />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && hits[active] ? `${listId}-${active}` : undefined}
          aria-label="Search settings"
          placeholder="Search settings"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.stopPropagation();
              setQuery("");
            } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (hits.length) setActive((i) => (i + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(hits[active]);
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
        />
        <kbd className="text-[10.5px] text-faint">⌘F</kbd>
      </label>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching settings"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-[60vh] overflow-y-auto rounded-lg border border-line-strong bg-panel p-1 shadow-lg"
        >
          {hits.length === 0 && <li className="px-2.5 py-2 text-[12.5px] text-faint">No setting matches “{query.trim()}”</li>}
          {hits.map((hit, i) => (
            <li
              key={`${hit.page}:${hit.title ?? ""}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, so the pick lands before the input's blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(hit);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-baseline justify-between gap-2 rounded-md px-2.5 py-1.5 text-[12.5px] ${
                i === active ? "bg-accent-soft text-ink" : "text-muted"
              }`}
            >
              <span className="min-w-0 truncate text-ink">{hit.title ?? hit.pageLabel}</span>
              <span className="shrink-0 text-[11px] text-faint">{hit.title ? hit.pageLabel : "Page"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
