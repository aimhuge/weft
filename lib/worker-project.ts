// A project that lives on a Weft Worker, as the desktop board holds it (docs/architecture/weft-worker.md#worker-projects-on-the-desktop-board).
// The board's projects are paths, so a worker's is one too: worker://<worker id>/<folder>. Nothing on this Mac is at
// that path, which is the point: a card or project carrying it reads from the cloud rows and acts through
// cloud_commands, and every path that would touch a local folder or start a local CLI checks here first.
import type { ProjectSummary, ProjectWorker, WorkerProjectStatus } from "./board-view";
import type { MenuItem } from "./card-menu";
import type { Card, Column } from "./types";

export type { WorkerProjectStatus };

const SCHEME = "worker://";

// One project on one of your workers.
export interface WorkerProject {
  path: string;
  workerId: string;
  worker: string;
  folder: string;
  status: WorkerProjectStatus;
}

export interface WorkerBoard {
  signedIn: boolean;
  projects: WorkerProject[];
  // Each with its cwd set to its project's path, so the board's own grouping files it there.
  cards: Card[];
}

export const EMPTY_WORKER_BOARD: WorkerBoard = { signedIn: false, projects: [], cards: [] };

export const workerProjectPath = (workerId: string, folder: string) => `${SCHEME}${workerId}/${folder}`;

export const isWorkerProject = (path: string | null | undefined): path is string => Boolean(path?.startsWith(SCHEME));

export const isWorkerCard = (card: Pick<Card, "cwd">) => isWorkerProject(card.cwd);

// The worker id and folder a project's path names, or null for anything else.
export function parseWorkerProject(path: string): { workerId: string; folder: string } | null {
  if (!isWorkerProject(path)) return null;
  const rest = path.slice(SCHEME.length);
  const slash = rest.indexOf("/");
  if (slash < 1 || slash === rest.length - 1) return null;
  return { workerId: rest.slice(0, slash), folder: rest.slice(slash + 1) };
}

// A folder the Mac can act on: what the terminal, the header badges and the drawers get, never a worker's path.
export const localPath = <T extends string | null | undefined>(path: T): T | null => (isWorkerProject(path) ? null : path);

// The line a project shows under its name: where it lives.
export const workerLabel = (w: ProjectWorker) => (w.status === "offline" ? `on ${w.name} · offline` : `on ${w.name}`);

export const offlineMessage = (worker: string) => `${worker} is offline, so this didn't start. Nothing ran on this Mac; try again once it's back.`;

// The local projects with the workers' beside them: a worker project with no cards yet gets a row of its own, and
// each one says which worker it's on.
export function withWorkerProjects(summaries: ProjectSummary[], projects: WorkerProject[]): ProjectSummary[] {
  const marks = new Map(projects.map((p) => [p.path, { name: p.worker, status: p.status }]));
  const known = new Set(summaries.map((s) => s.path));
  const empty = projects.filter((p) => !known.has(p.path)).map((p): ProjectSummary => ({ path: p.path, lastActivity: 0, cards: 0, running: 0, needsYou: 0 }));
  return [...summaries, ...empty].map((s) => {
    const worker = marks.get(s.path);
    return worker ? { ...s, worker } : s;
  });
}

// The columns without the worker's cards, for what acts on many local cards at once (Archive all, Resume all, Switch
// all): none of those reach a worker.
export function localColumns(byColumn: Map<Column, Card[]>): Map<Column, Card[]> {
  return new Map([...byColumn].map(([column, cards]) => [column, cards.filter((c) => !isWorkerCard(c))]));
}

// A worker project's right-click menu: only what a board can do from here. An offline worker can't take a thread.
export function workerProjectMenu(name: string, worker: ProjectWorker): MenuItem[] {
  return [{ id: "new", label: `New Thread in ${name}`, enabled: worker.status !== "offline", detail: workerLabel(worker) }];
}
