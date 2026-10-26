"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { keyLabel, useShortcutHint, useShortcutList } from "@/lib/hotkeys";
import { useEscape } from "@/lib/use-escape";
import { useMenuOpen } from "@/lib/use-menu-open";
import type { ProjectSummary, SortKey } from "@/lib/board-view";
import type { ViewMode } from "@/lib/board-prefs";
import { SORTS } from "./project-bar-shared";
import Icon from "./Icon";
import ProjectChips from "./ProjectChips";
import ProjectMenu from "./ProjectMenu";
import ViewToggle from "./ViewToggle";

export type { ProjectSummary, SortKey };
export { folderName, shortPath } from "@/lib/project-bar";
export { SORTS } from "./project-bar-shared";

const CHIP = "flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px]";
const CHIP_ON = "border-accent bg-accent-soft text-accent";
const CHIP_OFF = "border-line-strong text-ink hover:bg-sunken";

// The row under the header: a chip per project (the folder its cards run in, with a dot when one is
// running or needs you), the filter box and the sort.
export default function ProjectBar({
  projects,
  total,
  selected,
  onSelect,
  filter,
  sort,
  onSort,
  view,
  onView,
  home,
  onMenuOpenChange,
  onProjectMenu,
  variant = "desktop",
}: {
  projects: ProjectSummary[]; // already sorted, most recent first
  total: number; // total card count, for the "All" chip
  selected: string | null; // selected project path, null = all projects
  onSelect: (path: string | null) => void;
  filter: ReactNode; // the filter box, drawn before the sort menu
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  // The board's layout: cards in columns or in one list.
  view: ViewMode;
  onView: (view: ViewMode) => void;
  home: string; // user's home dir, for shortening paths (~/dev/x) and default parent for new projects
  onMenuOpenChange?: (open: boolean) => void; // called when the dropdown opens/closes (the board hides a native browser overlay while it's open)
  // Right-clicking a project, on its chip or in "More" (components/project-menu-handler.ts); resolves to whether an item was picked.
  onProjectMenu?: (path: string, e: React.MouseEvent) => Promise<boolean>;
  // "web" is the same bar on weft.zip, where the project menu can only pick a project (the Mac's
  // filesystem is out of reach) and the sort's dropdown is styled dark so it isn't light-on-dark.
  variant?: "desktop" | "web";
}) {
  const [open, setOpen] = useState(false);
  useEscape(open, () => setOpen(false));
  const menuRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const hint = useShortcutHint();
  const shortcuts = useShortcutList();
  const keyOf = (id: string) => shortcuts.find((s) => s.id === id)?.keys[0];
  const [prevKey, nextKey] = [keyOf("project-previous"), keyOf("project-next")];
  const stepHint = prevKey && nextKey ? `\n${keyLabel(prevKey)} ${keyLabel(nextKey)} step through projects` : "";

  // While the menu is open, an outside click or Escape closes it. The board hears when it opens
  // and closes, including when the bar unmounts with the menu open.
  useMenuOpen({ open, setOpen, onOpenChange: onMenuOpenChange, menuRef });

  // Keep the selected chip visible when the chip row scrolls.
  useEffect(() => {
    chipsRef.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected]);

  function toggleMenu() {
    if (!open) setOpen(true);
    else setOpen(false);
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-panel px-4">
      <ProjectChips projects={projects} total={total} selected={selected} onSelect={onSelect} home={home} chipsRef={chipsRef} stepHint={stepHint} onProjectMenu={onProjectMenu && ((path, e) => void onProjectMenu(path, e))} />

      <div ref={menuRef} className="relative shrink-0">
        <button
          onClick={toggleMenu}
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          className={`${CHIP} ${open ? CHIP_ON : CHIP_OFF}`}
        >
          More
          <Icon name="chevronDown" size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <ProjectMenu
            projects={projects}
            selected={selected}
            onSelect={(p) => { onSelect(p); setOpen(false); }}
            onProjectMenu={onProjectMenu && ((path, e) => void onProjectMenu(path, e).then((picked) => picked && setOpen(false)))}
            home={home}
            menuId={menuId}
            variant={variant}
          />
        )}
      </div>

      <div className="min-w-2 flex-1" />

      {filter}

      <ViewToggle mode={view} onChange={onView} />

      <select
        value={sort}
        onChange={(e) => onSort(e.target.value as SortKey)}
        aria-label="Sort cards"
        title={hint("sort", "Sort cards")}
        // On weft.zip the page is dark but the browser's dropdown is not, so the opened list would
        // be light-on-dark. The desktop app is always dark, so it doesn't need the hint.
        style={variant === "web" ? { colorScheme: "dark" } : undefined}
        className="shrink-0 rounded-md border border-line-strong bg-canvas px-2 py-1 text-[12px] text-ink outline-none focus:border-accent"
      >
        {SORTS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}
