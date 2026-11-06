"use client";

import { useUiText } from "@/lib/ui-language";
import { useLayoutEffect, useRef, useState } from "react";
import { folderName } from "@/lib/format";
import { currentArea, fitWidth } from "@/lib/float-place";
import { useShortcutList } from "@/lib/hotkeys";
import type { FilterMatch } from "@/lib/board-view";
import type { Card } from "@/lib/types";
import { COLUMN_LABEL, COLUMN_PILL } from "./CommandPalette";
import Icon from "./Icon";
import KeyCaps from "./KeyCaps";
import TagPill from "./TagPill";

const LIST_WIDTH = 320;
const MARGIN = 8;

// The board's filter: the input in the project bar, its "/" key hint, and while typing a short list
// of the matching cards to open, ending in a row that hands the text to the command palette.
export default function FilterBox({
  query,
  onQuery,
  matches,
  onOpen,
  onSearchAll,
}: {
  query: string;
  onQuery: (query: string) => void;
  matches: FilterMatch[]; // the cards the filter matches, already cut to the few worth listing
  onOpen: (card: Card) => void;
  onSearchAll: () => void; // opens the command palette with this query
}) {
  const t = useUiText();
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const [spot, setSpot] = useState<{ left: number; top: number; width: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const shortcuts = useShortcutList();
  const keyOf = (id: string) => shortcuts.find((s) => s.id === id)?.keys[0];
  const filterKey = keyOf("filter");
  const paletteKey = keyOf("palette");
  const open = focused && Boolean(query.trim());
  // The matches, then the "search everything" row.
  const rows = matches.length + 1;
  const current = Math.min(active, rows - 1);

  // The list floats below the input, kept left of the browser pane: the pane is a native view and
  // would cover it.
  useLayoutEffect(() => {
    const el = input.current;
    if (!open || !el) return;
    const place = () => {
      const r = el.getBoundingClientRect();
      const area = currentArea();
      const width = fitWidth(area, LIST_WIDTH);
      const left = Math.max(area.left + MARGIN, Math.min(r.right - width, area.right - width - MARGIN));
      setSpot({ left, top: r.bottom + 4, width });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  function choose(index: number) {
    const match = matches[index];
    if (match) {
      input.current?.blur();
      onOpen(match.card);
    } else {
      onSearchAll();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape" && query) {
      e.stopPropagation();
      onQuery("");
    } else if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setActive((current + (e.key === "ArrowDown" ? 1 : rows - 1)) % rows);
    } else if (open && e.key === "Enter") {
      e.preventDefault();
      choose(current);
    }
  }

  return (
    <div className="relative w-[200px] min-w-[120px] shrink">
      <Icon name="search" size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
      <input
        ref={input}
        type="text"
        value={query}
        onChange={(e) => {
          onQuery(e.target.value);
          setActive(0);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
        placeholder={t("Filter cards")}
        aria-label={t("Filter cards")}
        aria-expanded={open}
        aria-controls="filter-matches"
        aria-activedescendant={open ? `filter-row-${current}` : undefined}
        role="combobox"
        className="w-full rounded-md border border-line-strong bg-canvas py-1 pl-7 pr-6 text-[12px] text-ink outline-none placeholder:text-faint focus:border-accent"
      />
      {!query && filterKey && (
        <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 opacity-70">
          <KeyCaps spec={filterKey} small />
        </span>
      )}
      {query && (
        <button
          onClick={() => onQuery("")}
          aria-label={t("Clear filter")}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:bg-sunken hover:text-ink"
        >
          <Icon name="x" size={12} />
        </button>
      )}

      {open && spot && (
        <ul
          id="filter-matches"
          role="listbox"
          aria-label={t("Matching cards")}
          // A click on a row would blur the input and close the list before the click lands.
          onMouseDown={(e) => e.preventDefault()}
          className="fixed z-40 rounded-lg border border-line bg-panel p-1 shadow-lg"
          style={spot}
        >
          {matches.length === 0 && <li className="px-2.5 py-1.5 text-[12px] text-faint">No cards match</li>}
          {matches.map((match, i) => {
            const { card, matchedTag } = match;
            return (
              <li
                key={card.id}
                id={`filter-row-${i}`}
                role="option"
                aria-selected={i === current}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(i)}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 ${i === current ? "bg-accent-soft" : ""}`}
              >
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{card.title}</span>
                {matchedTag && <TagPill tag={matchedTag} className="max-w-[80px] shrink-0" />}
                <span className="max-w-[80px] shrink-0 truncate text-[11px] text-faint">{folderName(card.cwd)}</span>
                <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-semibold ${COLUMN_PILL[card.column]}`}>
                  {t(COLUMN_LABEL[card.column])}
                </span>
              </li>
            );
          })}
          <li
            id={`filter-row-${matches.length}`}
            role="option"
            aria-selected={current === matches.length}
            onMouseMove={() => setActive(matches.length)}
            onClick={() => choose(matches.length)}
            className={`mt-1 flex cursor-pointer items-center gap-2 rounded-md border-t border-line px-2.5 py-1.5 text-[12px] text-muted ${
              current === matches.length ? "bg-accent-soft text-ink" : ""
            }`}
          >
            <Icon name="search" size={12} />
            <span className="min-w-0 flex-1 truncate">
              {t("Search prompts, projects and commands for")}{" "}<span className="text-ink">“{query.trim()}”</span>
            </span>
            {paletteKey && <KeyCaps spec={paletteKey} small />}
          </li>
        </ul>
      )}
    </div>
  );
}
