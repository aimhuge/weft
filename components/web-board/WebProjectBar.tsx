"use client";

// The row under the header: a chip per project (the folder its cards run in, with a dot when one is
// running or needs you), the filter box and the sort. The desktop's ProjectBar without its folder
// forms: a browser tab can't open a folder on the Mac that runs the cards.
import { SORTERS, type ProjectSummary, type SortKey } from "@/lib/board-view";
import { folderName } from "@/lib/format";

const SORT_LABELS: Record<SortKey, string> = { newest: "Newest first", active: "Recently active", oldest: "Oldest first" };

const CHIP = "flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px]";
const CHIP_ON = "border-accent bg-accent-soft text-accent";
const CHIP_OFF = "border-line-strong text-ink hover:bg-sunken";

// Warn (needs you) wins over accent (running).
function StatusDot({ project }: { project: ProjectSummary }) {
  if (project.needsYou > 0) return <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />;
  if (project.running > 0) return <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />;
  return null;
}

function statusLabel(project: ProjectSummary) {
  const parts: string[] = [];
  if (project.needsYou > 0) parts.push(`${project.needsYou} ${project.needsYou === 1 ? "needs" : "need"} you`);
  if (project.running > 0) parts.push(`${project.running} running`);
  return parts.length ? `, ${parts.join(", ")}` : "";
}

export function WebProjectBar({
  projects,
  total,
  selected,
  onSelect,
  query,
  onQuery,
  sort,
  onSort,
}: {
  projects: ProjectSummary[]; // most recent first
  total: number;
  selected: string | null;
  onSelect: (path: string | null) => void;
  query: string;
  onQuery: (query: string) => void;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
}) {
  return (
    <div className="mx-3 mt-2 flex shrink-0 items-center gap-2">
      <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
        <button onClick={() => onSelect(null)} aria-pressed={selected === null} className={`${CHIP} ${selected === null ? CHIP_ON : CHIP_OFF}`}>
          All
          <span className={`tabular-nums ${selected === null ? "text-accent/70" : "text-faint"}`}>{total}</span>
        </button>
        {projects.map((project) => {
          const on = project.path === selected;
          return (
            <button key={project.path} onClick={() => onSelect(on ? null : project.path)} aria-pressed={on} title={project.path} className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}>
              <StatusDot project={project} />
              <span className="max-w-[160px] truncate">{folderName(project.path)}</span>
              <span className={`tabular-nums ${on ? "text-accent/70" : "text-faint"}`}>{project.cards}</span>
              <span className="sr-only">{statusLabel(project)}</span>
            </button>
          );
        })}
      </div>
      <div className="min-w-0 flex-1" />
      <input
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Filter cards"
        aria-label="Filter cards"
        className="w-40 min-w-0 shrink rounded-md border border-line-strong bg-canvas px-2.5 py-1 text-[12px] text-ink outline-none placeholder:text-faint focus:border-accent"
      />
      <select
        value={sort}
        onChange={(e) => onSort(e.target.value as SortKey)}
        aria-label="Sort cards"
        // Dark, so the dropped-open option list isn't light-on-dark against the board.
        style={{ colorScheme: "dark" }}
        className="shrink-0 rounded-md border border-line-strong bg-canvas px-2 py-1 text-[12px] text-ink outline-none focus:border-accent"
      >
        {(Object.keys(SORTERS) as SortKey[]).map((id) => (
          <option key={id} value={id}>
            {SORT_LABELS[id]}
          </option>
        ))}
      </select>
    </div>
  );
}
