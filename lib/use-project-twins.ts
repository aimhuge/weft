"use client";

import { useMemo } from "react";
import { groupByColumn, summarizeProjects, type BoardView } from "./board-view";
import { filterCards, type RailFilter } from "./rail-view";
import type { Card, Project } from "./types";
import { projectKeyOf, twinMap } from "./worker-twin";
import { isWorkerProject, withWorkerProjects, type WorkerProject } from "./worker-project";

interface Deps {
  // The selection as saved or clicked: a local path, a `worker://` one, or null for All.
  selected: string | null;
  projects: Project[];
  cards: Card[];
  workerProjects: WorkerProject[];
  rootOf: (cwd: string) => string;
  railFilter: RailFilter;
  view: Omit<BoardView, "project">;
}

// One chip per project: a Weft Worker's checkout of a repo that is also a folder here folds into the local project
// (lib/worker-twin.ts). A card is PLACED by `projectOf` (columns, counts, the menu's cards, the palette), while a
// folder is ACTED on by `rootOf` (the terminal, drawers, new threads), which keeps the local path. A view-layer fold:
// leases, transport and storage still see each card where it runs.
export function useProjectTwins({ selected, projects, cards, workerProjects, rootOf, railFilter, view }: Deps) {
  const twins = useMemo(() => {
    const local = [...projects.map((p) => rootOf(p.path)), ...cards.filter((c) => !isWorkerProject(c.cwd)).map((c) => rootOf(c.cwd))];
    return twinMap(local, workerProjects.map((p) => p.path));
  }, [projects, cards, workerProjects, rootOf]);
  const projectOf = useMemo(() => projectKeyOf(twins, rootOf), [twins, rootOf]);
  // A saved `worker://` selection means its local twin.
  const project = selected ? (twins.get(selected) ?? selected) : null;
  const { query, sort, showArchived, reviewFilter } = view;
  const byColumn = useMemo(
    () => groupByColumn(filterCards(cards, railFilter), { project, query, sort, showArchived, reviewFilter }, projectOf),
    [cards, railFilter, project, query, sort, showArchived, reviewFilter, projectOf],
  );
  const archivedCount = cards.filter((c) => c.archived && (!project || projectOf(c.cwd) === project)).length;
  const summaries = useMemo(
    () => withWorkerProjects(summarizeProjects(projects, cards, projectOf), workerProjects, twins),
    [projects, cards, projectOf, workerProjects, twins],
  );
  return { projectOf, project, summaries, byColumn, archivedCount };
}
