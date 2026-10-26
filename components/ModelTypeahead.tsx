"use client";

// The model typeahead: the field you pick a model in, everywhere Weft picks one.
//
// It is a combobox, not a native <select>. A native menu can't be typed into, can't be searched,
// and draws its own list wherever the OS feels like — which on a short window is off the bottom of
// the screen, and on a board with a browser pane on the right, under the pane. This one draws its
// own list: it opens below the field when there's room and above it when there isn't, and is
// clamped to the area the page can draw over (lib/float-place.ts), so it never runs off the edge.
//
// Typing filters the rows across every CLI at once; ↑/↓ move the highlight, Enter picks, Escape
// closes. The rows come from lib/model-options.ts, so every menu in Weft says the same thing.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { currentArea } from "@/lib/float-place";
import { placeDropdown } from "@/lib/dropdown-place";
import { filterGroups, labelFor, type ModelOption } from "@/lib/model-options";
import Icon from "./Icon";

// How tall the list may be before it scrolls.
const MAX_LIST_HEIGHT = 320;

export interface ModelTypeaheadProps {
  // The picked model id, or the "let the CLI choose" value.
  value: string;
  // The rows, grouped by the CLI that serves them.
  groups: { backend: string; heading: string; rows: ModelOption[] }[];
  onChange: (value: string) => void;
  // The field's own label, for the screen reader.
  label: string;
  // The class on the input; a caller that draws the box around it passes a bare one.
  className?: string;
  // The class on the button that opens the list; the default is a chevron.
  triggerClassName?: string;
  // Placeholder text for the field while it is empty.
  placeholder?: string;
  // Whether the field shows the picked model's name (true) or is a bare search box (false).
  showValue?: boolean;
}

export default function ModelTypeahead({
  value,
  groups,
  onChange,
  label,
  className = "",
  triggerClassName = "",
  placeholder = "Search models",
  showValue = true,
}: ModelTypeaheadProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [spot, setSpot] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // The ids the field and the group headings point at. Built from useId, not the label: a label has
  // spaces, and an id with spaces reads as several ids to aria-controls and aria-labelledby.
  const listId = useId();

  const filtered = useMemo(() => filterGroups(groups, query), [groups, query]);

  // The rows in the order they read, so the arrow keys walk the list as it looks.
  const rows = useMemo(() => filtered.flatMap((g) => g.rows), [filtered]);

  const current = Math.min(active, Math.max(0, rows.length - 1));

  const chosen = useMemo(() => labelFor(value, groups), [value, groups]);

  // The list's place: below the field when there's room, above it when there isn't, and always
  // inside the area the page can draw over.
  //
  // The place is only read while the list is open, so a closed list leaves the last one alone
  // rather than clearing it: opening again measures afresh.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = field.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const placement = placeDropdown(
        { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width },
        currentArea(),
        { width: Math.max(r.width, 220), height: MAX_LIST_HEIGHT },
      );
      setSpot({ ...placement.spot, width: placement.width, maxHeight: placement.maxHeight });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, filtered.length]);

  // A click outside closes the list.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // The highlighted row stays in view while arrowing through the list.
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current, open]);

  const show = useCallback(() => {
    setQuery("");
    setActive(0);
    setOpen(true);
    // The field takes the focus so the user can type straight away.
    requestAnimationFrame(() => input.current?.focus());
  }, []);

  const pick = useCallback(
    (next: string) => {
      onChange(next);
      setOpen(false);
      setQuery("");
      input.current?.blur();
    },
    [onChange],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      input.current?.blur();
      return;
    }
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (rows.length ? (i + 1) % rows.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[current];
      if (row) pick(row.value);
    }
  }

  return (
    <div ref={root} className="relative min-w-0">
      <div ref={field} className="relative flex items-center">
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={label}
          value={open ? query : showValue ? chosen : ""}
          placeholder={open ? placeholder : showValue ? chosen : placeholder}
          onFocus={() => {
            if (!open) show();
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            if (!open) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          spellCheck={false}
          className={`w-full bg-transparent outline-none placeholder:text-faint ${className}`}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Show models"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (open ? setOpen(false) : show())}
          className={`pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-muted ${triggerClassName}`}
        >
          <Icon name="chevronDown" size={12} />
        </button>
      </div>

      {open && spot && (
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label={label}
          // A click on a row would blur the field and close the list before the click lands.
          onMouseDown={(e) => e.preventDefault()}
          className="fixed z-50 overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-2xl"
          style={{ left: spot.left, top: spot.top, width: spot.width, maxHeight: spot.maxHeight }}
        >
          {rows.length === 0 && <p className="px-2.5 py-2 text-[12px] text-muted">No model matches “{query.trim()}”.</p>}
          {filtered.map((group) => (
            // Each CLI's rows are a group named by its heading, as the native menu's optgroups were.
            <div
              key={group.backend}
              role={group.heading ? "group" : undefined}
              aria-labelledby={group.heading ? `${listId}-${group.backend}` : undefined}
              className="mb-1 last:mb-0"
            >
              {group.heading && (
                <p id={`${listId}-${group.backend}`} className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-faint">
                  {group.heading}
                </p>
              )}
              {group.rows.map((row) => {
                const i = rows.indexOf(row);
                return (
                  <div
                    key={`${group.backend}:${row.value}`}
                    role="option"
                    aria-selected={i === current}
                    onMouseMove={() => setActive(i)}
                    onClick={() => pick(row.value)}
                    className={`flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 ${
                      i === current ? "bg-accent text-on-accent" : "text-ink"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[12.5px]">{row.label}</span>
                    {row.id && <span className={`max-w-[120px] shrink-0 truncate text-[11px] ${i === current ? "opacity-80" : "text-faint"}`}>{row.id}</span>}
                    {row.note && (
                      <span className={`shrink-0 text-[10.5px] ${i === current ? "opacity-80" : "text-faint"}`}>{row.note}</span>
                    )}
                    {i === current && <Icon name="check" size={12} className="shrink-0" />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
