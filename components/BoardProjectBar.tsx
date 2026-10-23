"use client";

// The bar under the header: project chips, the rail's ★/tag filter chip, the filter box (with the few
// cards it matches listed under it) and the sort menu, in its own CrashGuard. The web board on weft.zip
// draws the same bar (variant="web"), where the project menu can only pick a project.
import type { Card, Column } from "@/lib/types";
import { topMatches, type ProjectSummary, type SortKey } from "@/lib/board-view";
import type { RailFilter } from "@/lib/rail-view";
import CrashGuard from "./CrashGuard";
import ProjectBar from "./ProjectBar";
import FilterBox from "./FilterBox";
import RailFilterChip from "./RailFilterChip";

// Cards the filter box lists under itself while typing.
const FILTER_MATCHES = 5;

export interface BoardProjectBarProps {
  projects: ProjectSummary[];
  total: number;
  project: string | null;
  onProject: (path: string | null) => void;
  railFilter: RailFilter;
  onRailFilter: (filter: RailFilter) => void;
  query: string;
  onQuery: (query: string) => void;
  // The board's cards by column, for the filter box's matches.
  byColumn: Map<Column, Card[]>;
  onOpenCard: (card: Card) => void;
  // Opens the command palette with this query.
  onSearchAll: (query: string) => void;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  home: string;
  onMenuOpenChange: (open: boolean) => void;
  // "web" is the same bar on weft.zip, where the project menu can only pick a project.
  variant?: "desktop" | "web";
}

export default function BoardProjectBar(p: BoardProjectBarProps) {
  return (
    <CrashGuard what="project bar" className="mx-3 mt-2">
      <ProjectBar
        projects={p.projects}
        total={p.total}
        selected={p.project}
        onSelect={p.onProject}
        filter={
          <>
            <RailFilterChip filter={p.railFilter} onClear={p.onRailFilter} />
            <FilterBox
              query={p.query}
              onQuery={p.onQuery}
              matches={p.query.trim() ? topMatches(p.byColumn, FILTER_MATCHES, p.query) : []}
              onOpen={p.onOpenCard}
              onSearchAll={() => p.onSearchAll(p.query)}
            />
          </>
        }
        sort={p.sort}
        onSort={p.onSort}
        home={p.home}
        onMenuOpenChange={p.onMenuOpenChange}
        variant={p.variant}
      />
    </CrashGuard>
  );
}
