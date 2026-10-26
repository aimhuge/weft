"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type PaletteItem, paletteResults, RECENT_MORE_ID } from "@/lib/palette";
import Icon from "./Icon";
import Modal from "./Modal";
import { COLUMN_LABEL, COLUMN_PILL, ItemText, KeyCaps, ProjectChip, projectInk } from "./PaletteRows";

const PROMPT_DELAY_MS = 200;
const PROMPT_MIN_CHARS = 2;

export { COLUMN_LABEL, COLUMN_PILL };
export type { PaletteItem };

export default function CommandPalette({
  initialQuery = "",
  items,
  findPrompts,
  currentProject,
  onClose,
}: {
  // Text to start the search with, e.g. what was typed in the filter box.
  initialQuery?: string;
  items: PaletteItem[];
  // The project the board shows; cards and prompts stay inside it until the user unticks the scope.
  currentProject?: { path: string; name: string } | null;
  // Prompts the user wrote that match the query; resolves with palette items for the ones on the board.
  findPrompts: (query: string) => Promise<PaletteItem[]>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [prompts, setPrompts] = useState<{ query: string; items: PaletteItem[] }>({ query: "", items: [] });
  const [active, setActive] = useState(0);
  const [scoped, setScoped] = useState(true);
  const [allRecent, setAllRecent] = useState(false);
  const scope = scoped && currentProject ? currentProject.path : null;
  const list = useRef<HTMLUListElement>(null);
  // The board makes a new findPrompts on every render; a pending search shouldn't restart for that.
  const find = useRef(findPrompts);
  useEffect(() => {
    find.current = findPrompts;
  });

  // Searching prompts hits the server, so it waits for a pause in typing and drops stale answers.
  useEffect(() => {
    const text = query.trim();
    if (text.length < PROMPT_MIN_CHARS) return;
    let stale = false;
    const timer = setTimeout(() => {
      find.current(text).then(
        (found) => !stale && setPrompts({ query: text, items: found }),
        () => !stale && setPrompts({ query: text, items: [] }),
      );
    }, PROMPT_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  const results = useMemo(
    () => paletteResults(items, query, prompts, scope, allRecent),
    [items, query, prompts, scope, allRecent],
  );

  const current = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => {
    list.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  function choose(item: PaletteItem | undefined) {
    if (!item) return;
    // "Show more" opens the rest of the recent moves in place; the highlight stays put, on the first of them.
    if (item.id === RECENT_MORE_ID) {
      setAllRecent(true);
      return;
    }
    onClose();
    // After the palette has unmounted, so a command that moves focus keeps it.
    setTimeout(item.run, 0);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.nativeEvent.isComposing) return;
    const last = results.length - 1;
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) setActive(current >= last ? 0 : current + 1);
    else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) setActive(current <= 0 ? last : current - 1);
    else if (e.key === "Enter") choose(results[current]);
    else if (e.key === "Tab" && currentProject) {
      setScoped((v) => !v);
      setActive(0);
    }
    else return;
    e.preventDefault();
  }

  return (
    <Modal label="Command palette" onClose={onClose} layer="palette" placement="top" className="max-h-[min(680px,82vh)] w-full max-w-[840px] overflow-hidden">
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-3.5">
          <Icon name="search" size={19} className="text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search cards, prompts, and commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[current] ? `palette-${results[current].id}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-[18px] text-ink outline-none placeholder:text-faint"
          />
          {currentProject && (
            <label
              title={`Tab: search ${scoped ? "every project" : `only ${currentProject.name}`}`}
              className={`flex shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-full border px-2 py-0.5 text-[13.5px] font-medium ${
                scoped ? "border-transparent bg-accent-soft text-accent" : "border-line-strong text-muted"
              }`}
            >
              <input
                type="checkbox"
                checked={scoped}
                onChange={(e) => {
                  setScoped(e.target.checked);
                  setActive(0);
                }}
                className="size-3 accent-[var(--accent)]"
              />
              <span className="max-w-[140px] truncate">Only {currentProject.name}</span>
            </label>
          )}
          <kbd className="rounded border border-line-strong bg-sunken px-1.5 py-0.5 font-mono text-[13px] text-muted">Esc</kbd>
        </div>
        <ul id="palette-results" ref={list} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-[15px] text-muted">
              Nothing matches “{query.trim()}”{scope && currentProject ? ` in ${currentProject.name}. Press Tab to search every project.` : ""}
            </li>
          )}
          {results.map((item, index) => {
            const heading = item.group !== results[index - 1]?.group;
            return (
              <li key={item.id} role="presentation">
                {heading && (
                  <div className="px-2.5 pb-1 pt-2.5 text-[12.5px] font-semibold uppercase tracking-wider text-faint">{item.group}</div>
                )}
                <div
                  id={`palette-${item.id}`}
                  role="option"
                  aria-selected={index === current}
                  data-index={index}
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(item)}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 ${
                    index === current ? "bg-accent-soft shadow-[inset_2px_0_0_var(--accent)]" : ""
                  }`}
                >
                  <span className={`flex shrink-0 ${item.project ? "" : "text-muted"}`} style={item.project ? { color: projectInk(item.project) } : undefined}>
                    <Icon name={item.icon} size={18} />
                  </span>
                  <ItemText item={item} />
                  {item.project && item.group !== "Projects" && !scope && <ProjectChip name={item.project} />}
                  {item.when && <span className="w-[64px] shrink-0 text-right text-[13.5px] tabular-nums text-faint">{item.when}</span>}
                  {item.keys && <KeyCaps keys={item.keys} />}
                </div>
              </li>
            );
          })}
        </ul>
    </Modal>
  );
}
