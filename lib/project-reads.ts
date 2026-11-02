// What the header's badges read about a project (docs/architecture/project-hosts.md, H4): its code quality, the
// refactor scout's findings, the uncommitted pile and the Backlog. On this Mac each is a route that measures the folder
// now (localRead); on a Weft Worker it's the snapshot the worker published (lib/project-snapshot-view.ts). The badges
// ask `hostFor(cwd).read(name, cwd)` and never which it is.
import { apiFetch } from "./api-client";
import type { QualityReport } from "./quality-view";
import type { ScoutState } from "./scout-view";

export type PileSummary = { root: string; files: number; added: number; removed: number; cards: number };
export type BacklogSummary = { root: string; count: number; active: number };

export interface ProjectReads {
  quality: QualityReport | null;
  scout: ScoutState | null;
  pile: PileSummary | null;
  backlog: BacklogSummary | null;
}

// What a Weft Worker publishes per folder: the reads, and when it measured them (lib/project-snapshot.ts).
export type ProjectSnapshot = ProjectReads & { at: number };

export type ProjectRead = keyof ProjectReads;
export type ReadProject = <K extends ProjectRead>(name: K, project: string) => Promise<ProjectReads[K]>;

// The route each read is on this Mac, and the field its answer holds it in.
const ROUTES: Record<ProjectRead, string> = { quality: "/api/quality", scout: "/api/scout", pile: "/api/pile", backlog: "/api/sprint" };

export const localRead: ReadProject = async (name, cwd) => {
  const res = await apiFetch(`${ROUTES[name]}?cwd=${encodeURIComponent(cwd)}`);
  const body = (await res.json()) as Partial<ProjectReads>;
  return body[name] ?? null;
};
