"use client";

// Simple mode's board (docs/architecture/simple-mode.md #4): not a kanban but one narrow list on the left, like a
// chat app's conversations. Needs you, Working and Ready list their cards as compact rows (a status dot, the title,
// its age); Backlog and Done are headers with counts that open on a click, from the same cookie as their strips on
// the board (lib/three-piles.ts). A row opens its card the way a card on the board does, and a right-click opens the
// board's card menu. The open card sits inside the board beside the list, measuring it (lib/use-board-slot.ts).
import { useMemo, useSyncExternalStore } from "react";
import type { Card, Column } from "@/lib/types";
import { subscribeBoardPrefs } from "@/lib/board-prefs";
import { COLUMN_TONE } from "@/lib/column-tone";
import { stackRuns } from "@/lib/cron-stacks";
import { timeAgo } from "@/lib/format";
import { foldColumn, openedPiles, sidebarSections, type SidebarSection } from "@/lib/three-piles";
import { useUiText } from "@/lib/ui-language";
import { Chevron } from "./CardRowCells";

export interface BoardSidebarProps {
  columns: readonly { id: Column; label: string }[];
  byColumn: Map<Column, Card[]>;
  loaded: boolean;
  now: number;
  // The open card, drawn as the selected row.
  selectedId: string | null;
  onOpen: (card: Card) => void;
  // The board's own card menu on right-click, the same one a card on the kanban opens (lib/card-handlers.ts).
  onMenu?: (card: Card, e: React.MouseEvent) => void | Promise<void>;
  // The open card's thread is showing: the list folds to nothing but stays in place, so the card, which measures its
  // edge (lib/use-board-slot.ts), widens over to the rail.
  folded?: boolean;
}

export default function BoardSidebar({ columns, byColumn, loaded, now, selectedId, onOpen, onMenu, folded = false }: BoardSidebarProps) {
  const opened = useSyncExternalStore(subscribeBoardPrefs, openedPiles, () => "");
  // A cron's runs fold under the thread they came from, as on the board (lib/cron-stacks.ts).
  const stacked = useMemo(() => stackRuns(byColumn).byColumn, [byColumn]);
  const sections = sidebarSections(columns, stacked, opened);
  return (
    <nav data-board-surface data-board-sidebar aria-label="Threads" aria-hidden={folded || undefined}
      className={`flex shrink-0 flex-col bg-canvas py-2 ${folded ? "w-0 overflow-hidden" : "w-[280px] overflow-y-auto border-r border-line"}`}>
      {sections.map((section) => (
        <Section key={section.id} section={section} loaded={loaded} now={now} selectedId={selectedId} onOpen={onOpen} onMenu={onMenu} />
      ))}
    </nav>
  );
}

function Section({ section, loaded, now, selectedId, onOpen, onMenu }: { section: SidebarSection } & Omit<BoardSidebarProps, "columns" | "byColumn">) {
  const t = useUiText();
  const count = loaded ? <span className="ml-auto text-[11.5px] tabular-nums text-faint">{section.cards.length}</span> : null;
  const head = "flex w-full items-center gap-1.5 px-3 pb-1 pt-3 text-[11.5px] font-semibold uppercase tracking-wide text-muted";
  return (
    <section data-column={section.id} className="flex flex-col">
      {section.strip ? (
        <button
          aria-expanded={section.open}
          onClick={() => foldColumn(true, section.id, section.open)}
          className={`${head} hover:text-ink`}
        >
          <Chevron open={section.open} />
          {t(section.label)}
          {count}
        </button>
      ) : (
        <h3 className={head}>
          {t(section.label)}
          {count}
        </h3>
      )}
      {section.open && section.cards.map((card) => <Row key={card.id} card={card} column={section.id} now={now} selected={card.id === selectedId} onOpen={onOpen} onMenu={onMenu} />)}
    </section>
  );
}

// One card as a compact row: its column's dot (pulsing while it works), the title, and how long since it changed.
function Row({ card, column, now, selected, onOpen, onMenu }: { card: Card; column: Column; now: number; selected: boolean; onOpen: (card: Card) => void; onMenu?: BoardSidebarProps["onMenu"] }) {
  return (
    <button
      data-sidebar-card={card.id}
      aria-current={selected || undefined}
      onClick={() => onOpen(card)}
      onContextMenu={onMenu && ((e) => void onMenu(card, e))}
      title={card.title}
      className={`mx-1.5 flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left ${selected ? "bg-accent-soft" : "hover:bg-hover"}`}
    >
      <span className={`size-2 shrink-0 rounded-full ${COLUMN_TONE[column].dot} ${column === "running" ? "animate-pulse" : ""}`} aria-hidden />
      <span className={`min-w-0 flex-1 truncate text-[13px] ${column === "done" ? "text-muted" : "text-ink"}`}>{card.title}</span>
      <span className="shrink-0 text-[11px] tabular-nums text-faint">{timeAgo(card.updatedAt, now)}</span>
    </button>
  );
}
