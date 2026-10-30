// The horizontal row of project chips in the project bar — "All", the pinned ones, the recent ones up to
// six, and the selected project if it isn't one of them. Scrolls horizontally and keeps the selected chip
// in view. Right-clicking a chip opens its menu (components/project-menu-handler.ts).
import { type RefObject } from "react";
import { chipProjects, folderName, shortPath, statusLabel } from "@/lib/project-bar";
import { workerLabel } from "@/lib/worker-project";
import Icon from "./Icon";
import ProjectStatusDot from "./ProjectStatusDot";
import type { ProjectSummary } from "@/lib/board-view";

const CHIP = "flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px]";
const CHIP_ON = "border-accent bg-accent-soft text-accent";
const CHIP_OFF = "border-line-strong text-ink hover:bg-sunken";

// How many chips the pinned and most recent projects get between them; the rest are under "More".
const RECENT_CHIPS = 6;

export default function ProjectChips({
  projects,
  total,
  selected,
  onSelect,
  home,
  chipsRef,
  stepHint,
  onProjectMenu,
}: {
  projects: ProjectSummary[]; // already sorted, most recent first
  total: number; // total card count, for the "All" chip
  selected: string | null; // selected project path, null = all projects
  onSelect: (path: string | null) => void;
  home: string;
  chipsRef: RefObject<HTMLDivElement | null>;
  stepHint: string; // appended to chip titles, e.g. "← → step through projects"
  onProjectMenu?: (path: string, e: React.MouseEvent) => void;
}) {
  const chips = chipProjects(projects, selected, RECENT_CHIPS);

  return (
    <div ref={chipsRef} className="flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:thin]">
      <button
        onClick={() => onSelect(null)}
        aria-pressed={selected === null}
        title={`All projects${stepHint}`}
        className={`${CHIP} ${selected === null ? CHIP_ON : CHIP_OFF}`}
      >
        All
        <span className={`tabular-nums ${selected === null ? "text-accent/70" : "text-faint"}`}>{total}</span>
      </button>
      {chips.map((project) => {
        const on = project.path === selected;
        return (
          <button
            key={project.path}
            onClick={() => onSelect(project.path)}
            onContextMenu={onProjectMenu && ((e) => onProjectMenu(project.path, e))}
            aria-pressed={on}
            title={`${project.worker ? workerLabel(project.worker) : shortPath(project.path, home)}${stepHint}`}
            className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF} ${project.worker?.status === "offline" ? "opacity-60" : ""}`}
          >
            <ProjectStatusDot project={project} />
            {project.pinned && <Icon name="pin" size={11} className="text-faint" />}
            <span className="max-w-[160px] truncate">{folderName(project.path)}</span>
            {project.worker && <span className={on ? "text-accent/70" : "text-faint"}>{project.worker.name}</span>}
            <span className={`tabular-nums ${on ? "text-accent/70" : "text-faint"}`}>{project.cards}</span>
            <span className="sr-only">{statusLabel(project)}</span>
          </button>
        );
      })}
    </div>
  );
}
